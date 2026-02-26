"use client";

import { MessageType } from "@/components/ChatInterface";
import { User, Cpu } from "lucide-react";

export function Message({ message }: { message: MessageType }) {
    const isUser = message.role === "user";

    return (
        <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
            <div
                className={`flex max-w-[90%] md:max-w-[84%] gap-3 p-4 rounded-2xl ${isUser ? "bg-message-user text-foreground" : "bg-message-bot text-foreground"
                    } border border-border-custom`}
            >
                <div className="flex-shrink-0 mt-1">
                    {isUser ? (
                        <User className="w-4 h-4 stroke-1 text-text-muted" />
                    ) : (
                        <Cpu className="w-4 h-4 stroke-1 text-text-muted" />
                    )}
                </div>
                <div className="flex-1 space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                        {isUser ? "You" : "FTC Assistant"}
                    </div>
                    <div className="text-[15px] leading-7 whitespace-pre-wrap">
                        {message.content || (
                            <span className="inline-block w-4 h-4 bg-zinc-200 dark:bg-zinc-800 animate-pulse rounded-sm" />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
