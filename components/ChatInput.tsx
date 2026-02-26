"use client";

import { ArrowUp } from "lucide-react";
import { useState, KeyboardEvent, useRef, useEffect } from "react";

export function ChatInput({ onSend, disabled }: { onSend: (content: string) => void, disabled: boolean }) {
    const [input, setInput] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const MAX_TEXTAREA_HEIGHT = 168;

    const resizeTextarea = () => {
        const el = textareaRef.current;
        if (!el) return;

        el.style.height = "0px";
        const nextHeight = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
        el.style.height = `${nextHeight}px`;
        el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
    };

    useEffect(() => {
        resizeTextarea();
    }, [input]);

    const handleSend = () => {
        if (input.trim() && !disabled) {
            onSend(input);
            setInput("");
        }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="border border-border-custom/90 bg-background rounded-3xl shadow-sm focus-within:ring-2 focus-within:ring-text-muted/30 px-3 py-2.5">
            <div className="flex items-end gap-2">
                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Message FTC..."
                    rows={1}
                    className="w-full px-2 py-2 focus:outline-none resize-none bg-transparent text-[15px] leading-6 min-h-[44px] max-h-[168px] overflow-y-auto [scrollbar-gutter:stable] placeholder:text-text-muted"
                    disabled={disabled}
                />
                <button
                    onClick={handleSend}
                    disabled={disabled || !input.trim()}
                    className="mb-1 p-2 rounded-full bg-foreground text-background disabled:opacity-25 transition-opacity"
                    aria-label="Send message"
                >
                    <ArrowUp className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}
