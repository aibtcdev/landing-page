"use client";

import { useState, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  text: string;
  children: ReactNode;
  className?: string;
}

export default function Tooltip({ text, children, className = "" }: TooltipProps) {
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, position: "top" as "top" | "bottom" });
  const triggerRef = useRef<HTMLDivElement>(null);

  const handleShow = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const above = rect.top > 80;
    setCoords({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: rect.left + rect.width / 2,
      position: above ? "top" : "bottom",
    });
    setShow(true);
  }, []);

  return (
    <div
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={handleShow}
      onMouseLeave={() => setShow(false)}
      onFocus={handleShow}
      onBlur={() => setShow(false)}
      tabIndex={0}
    >
      {children}
      {show && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[9999] w-52 -translate-x-1/2 rounded-lg border border-white/10 bg-[rgba(15,15,15,0.95)] px-3 py-2.5 text-[11px] leading-relaxed text-white/70 shadow-xl backdrop-blur-xl"
          style={{
            top: coords.position === "top" ? undefined : coords.top,
            bottom: coords.position === "top" ? `${window.innerHeight - coords.top}px` : undefined,
            left: coords.left,
          }}
        >
          {text}
          <div
            className={`absolute left-1/2 -translate-x-1/2 border-[5px] border-transparent ${
              coords.position === "top"
                ? "top-full border-t-[rgba(15,15,15,0.95)]"
                : "bottom-full border-b-[rgba(15,15,15,0.95)]"
            }`}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
