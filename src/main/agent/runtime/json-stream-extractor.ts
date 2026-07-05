/**
 * A utility class to parse LLM JSON response streams incrementally and extract
 * natural language text fields (like `data.content` for assistant messages/questions,
 * or `summary` for SubmitCommands tool calls) in real-time.
 * It prevents leaking technical JSON objects (like commands) or background tool calls to the chat UI.
 */
export class JsonStreamExtractor {
  private accumulated = "";
  private isJson = false;
  private hasCheckedFirstChar = false;
  private targetKey: "content" | "summary" | null = null;
  private hasCheckedType = false;
  private hasCheckedToolName = false;
  private ignoreStreaming = false;
  private valueStartIndex = -1;
  private valueEndIndex = -1;
  private rawStreamedLength = 0;

  constructor(
    private readonly onChunk: (text: string, source: "message" | "tool-summary") => void,
  ) {}

  feed(chunk: string) {
    this.accumulated += chunk;

    if (!this.hasCheckedFirstChar) {
      const trimmed = this.accumulated.trimStart();
      if (trimmed.length === 0) return;
      const firstChar = trimmed[0];
      if (firstChar === "{" || firstChar === "`") {
        this.isJson = true;
      } else {
        this.ignoreStreaming = true;
        return;
      }
      this.hasCheckedFirstChar = true;
    }

    if (this.ignoreStreaming) {
      return;
    }

    if (!this.isJson) {
      return;
    }

    // JSON mode: Determine target key based on "type" and "toolName"
    if (!this.hasCheckedType) {
      const typeMatch = /"type"\s*:\s*["']([^"']+)["']/.exec(this.accumulated);
      if (!typeMatch) {
        if (this.accumulated.length > 200) {
          this.ignoreStreaming = true;
        }
        return;
      }
      const typeValue = typeMatch[1];
      if (typeValue === "assistant.message") {
        this.targetKey = "content";
      } else if (typeValue === "assistant.ask_user") {
        this.targetKey = "content";
      } else if (typeValue === "tool.call") {
        this.targetKey = null; // Need to determine based on toolName next
      } else {
        this.ignoreStreaming = true;
      }
      this.hasCheckedType = true;
    }

    // Determine targetKey for tool calls
    if (this.hasCheckedType && !this.hasCheckedToolName && this.targetKey === null && !this.ignoreStreaming) {
      const toolNameMatch = /"toolName"\s*:\s*["']([^"']+)["']/.exec(this.accumulated);
      if (!toolNameMatch) {
        if (this.accumulated.length > 400) {
          this.ignoreStreaming = true;
        }
        return;
      }
      const toolName = toolNameMatch[1];
      if (toolName === "SubmitCommands") {
        this.targetKey = "summary";
      } else {
        // Ignore streaming for background tools (like SearchExtraTools, GetSelection, etc.)
        this.ignoreStreaming = true;
      }
      this.hasCheckedToolName = true;
    }

    if (this.ignoreStreaming) {
      return;
    }

    // Locate the target key and the opening quote of its string value
    if (this.targetKey !== null && this.valueStartIndex === -1) {
      const escapedKey = this.targetKey.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
      const keyRegex = new RegExp('["\']' + escapedKey + '["\']\\s*:\\s*["\']');
      const keyMatch = keyRegex.exec(this.accumulated);
      if (!keyMatch) {
        return; // Wait for the key and opening quote
      }
      this.valueStartIndex = keyMatch.index + keyMatch[0].length;
    }

    // Scan the string value and stream unescaped characters up to the closing quote
    if (this.valueStartIndex !== -1 && this.valueEndIndex === -1) {
      let isEscaped = false;
      for (let i = this.valueStartIndex; i < this.accumulated.length; i++) {
        const char = this.accumulated[i];
        if (isEscaped) {
          isEscaped = false;
        } else if (char === "\\") {
          isEscaped = true;
        } else if (char === '"') {
          this.valueEndIndex = i;
          break;
        }
      }

      const currentEnd = this.valueEndIndex !== -1 ? this.valueEndIndex : this.accumulated.length;
      const rawUnprocessed = this.accumulated.slice(this.valueStartIndex + this.rawStreamedLength, currentEnd);
      
      if (rawUnprocessed.length > 0) {
        // Check for incomplete escape sequence at the end of rawUnprocessed
        let backslashCount = 0;
        for (let i = rawUnprocessed.length - 1; i >= 0; i--) {
          if (rawUnprocessed[i] === "\\") {
            backslashCount++;
          } else {
            break;
          }
        }

        // If the chunk ends with an odd number of backslashes, the last backslash is part of an
        // incomplete escape sequence (e.g. \n or \"), so we wait until the next feed to consume it.
        const consumeLength = rawUnprocessed.length - (backslashCount % 2);
        if (consumeLength > 0) {
          const rawToConsume = rawUnprocessed.slice(0, consumeLength);
          const decoded = this.unescape(rawToConsume);
          if (decoded.length > 0) {
            const source = this.targetKey === "summary" ? "tool-summary" : "message";
            this.onChunk(decoded, source);
          }
          this.rawStreamedLength += consumeLength;
        }
      }
    }
  }

  private unescape(str: string): string {
    return str.replace(/\\(.)/g, (match, char) => {
      switch (char) {
        case "n": return "\n";
        case "r": return "\r";
        case "t": return "\t";
        case "b": return "\b";
        case "f": return "\f";
        default: return char;
      }
    });
  }
}
