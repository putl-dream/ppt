import type { TableElement } from "@shared/presentation";

interface TableElementViewProps {
  element: TableElement;
  headerBg?: string;
  stripeBg?: string;
  textColor?: string;
  borderColor?: string;
}

export function TableElementView({
  element,
  headerBg = "#f1f5f9",
  stripeBg = "#f8fafc",
  textColor = "#334155",
  borderColor = "#e2e8f0",
}: TableElementViewProps) {
  const { rows, headerRow = true, zebraStripe = true } = element;
  const colCount = Math.max(...rows.map((row) => row.length), 1);

  return (
    <table
      style={{
        width: "100%",
        height: "100%",
        borderCollapse: "collapse",
        fontSize: 14,
        color: textColor,
        tableLayout: "fixed",
      }}
    >
      <tbody>
        {rows.map((row, rowIdx) => {
          const isHeader = headerRow && rowIdx === 0;
          const isStripe = zebraStripe && rowIdx % 2 === 1;
          const bg = isHeader ? headerBg : isStripe ? stripeBg : "transparent";
          return (
            <tr key={rowIdx} style={{ backgroundColor: bg }}>
              {Array.from({ length: colCount }).map((_, colIdx) => (
                <td
                  key={colIdx}
                  style={{
                    border: `1px solid ${borderColor}`,
                    padding: "6px 10px",
                    fontWeight: isHeader ? 600 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row[colIdx] ?? ""}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function tableToHtml(element: TableElement): string {
  const { rows, headerRow = true } = element;
  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const bodyRows = rows
    .map((row, rowIdx) => {
      const tag = headerRow && rowIdx === 0 ? "th" : "td";
      const cells = Array.from({ length: colCount })
        .map((_, colIdx) => `<${tag}>${escapeHtml(row[colIdx] ?? "")}</${tag}>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table class="slide-table">${bodyRows}</table>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
