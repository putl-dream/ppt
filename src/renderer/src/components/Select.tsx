import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/cx";
import { CheckIcon, ChevronDownIcon } from "./Icons";

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  variant?: "settings" | "block" | "ide";
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
  placement: "below" | "above";
}

const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 280;
const MENU_MIN_WIDTH = 180;

function measureMenuPosition(trigger: HTMLElement): MenuPosition {
  const rect = trigger.getBoundingClientRect();
  const width = Math.max(rect.width, MENU_MIN_WIDTH);
  const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
  const spaceAbove = rect.top - MENU_GAP;
  const placeAbove = spaceBelow < Math.min(MENU_MAX_HEIGHT, 160) && spaceAbove > spaceBelow;

  if (placeAbove) {
    return {
      top: Math.max(8, rect.top - MENU_GAP),
      left: Math.min(rect.left, window.innerWidth - width - 8),
      width,
      placement: "above",
    };
  }

  return {
    top: rect.bottom + MENU_GAP,
    left: Math.min(rect.left, window.innerWidth - width - 8),
    width,
    placement: "below",
  };
}

export function Select({
  value,
  options,
  onChange,
  variant = "settings",
  placeholder = "选择…",
  disabled = false,
  ariaLabel,
  className,
}: SelectProps) {
  const listboxId = useId();
  const optionIdPrefix = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<MenuPosition | null>(null);

  const selected = options.find((option) => option.value === value);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const resolvedVariant = variant === "ide" ? "settings" : variant;

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setPosition(measureMenuPosition(trigger));
    setOpen(true);
  }, [disabled, options.length, selectedIndex]);

  const selectValue = useCallback(
    (next: string) => {
      onChange(next);
      close();
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [close, onChange],
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    setPosition(measureMenuPosition(triggerRef.current));
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const reposition = () => {
      if (!triggerRef.current) return;
      setPosition(measureMenuPosition(triggerRef.current));
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        close();
        if (event.key === "Escape") {
          window.requestAnimationFrame(() => triggerRef.current?.focus());
        }
        return;
      }

      if (options.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % options.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const option = options[activeIndex];
        if (option) selectValue(option.value);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [activeIndex, close, open, options, selectValue]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const optionEl = menuRef.current?.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    );
    optionEl?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, open]);

  const activeOptionId = activeIndex >= 0 ? `${optionIdPrefix}-option-${activeIndex}` : undefined;

  const menu =
    open && position
      ? createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className={cx("ui-select-menu", position.placement === "above" && "is-above")}
            style={{
              top: position.placement === "above" ? undefined : position.top,
              bottom:
                position.placement === "above" ? window.innerHeight - position.top : undefined,
              left: position.left,
              width: position.width,
              maxHeight: MENU_MAX_HEIGHT,
            }}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <button
                  key={option.value === "" ? "__empty__" : option.value}
                  id={`${optionIdPrefix}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-option-index={index}
                  className={cx(
                    "ui-select-option",
                    isSelected && "is-selected",
                    isActive && "is-active",
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectValue(option.value)}
                >
                  <span className="ui-select-option-copy">
                    <span className="ui-select-option-label">{option.label}</span>
                    {option.hint ? (
                      <span className="ui-select-option-hint">{option.hint}</span>
                    ) : null}
                  </span>
                  {isSelected ? <CheckIcon size={12} className="ui-select-option-check" /> : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={cx(
        "ui-select",
        `ui-select--${resolvedVariant}`,
        open && "is-open",
        disabled && "is-disabled",
        className,
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        className={cx("ui-select-trigger", open && "is-open")}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          if (open) close();
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
          }
        }}
      >
        <span className={cx("ui-select-value", !selected && "is-placeholder")}>
          {selected ? (
            <>
              <span className="ui-select-value-label">{selected.label}</span>
              {selected.hint ? <span className="ui-select-value-hint">{selected.hint}</span> : null}
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDownIcon size={12} className="ui-select-chevron" />
      </button>
      {menu}
    </div>
  );
}
