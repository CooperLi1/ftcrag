"use client";

import { MessageType } from "@/components/ChatInterface";
import { User, Cpu } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";

export function Message({ message, loadingLabel }: { message: MessageType; loadingLabel?: string }) {
    const isUser = message.role === "user";
    const [showSources, setShowSources] = useState(false);

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
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted flex items-center gap-2">
                        <span>{isUser ? "You" : "FTC Assistant"}</span>
                        {!isUser && loadingLabel && (
                            <span className="normal-case tracking-normal text-[11px] text-text-muted/90">
                                {loadingLabel}
                            </span>
                        )}
                    </div>
                    <div className="text-[15px] leading-7 whitespace-pre-wrap">
                        {message.content ? (
                            isUser ? (
                                message.content
                            ) : (
                                <div className="space-y-3 break-words">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            p: ({ children }) => <p className="leading-7">{children}</p>,
                                            ul: ({ children }) => <ul className="list-disc pl-5 space-y-1">{children}</ul>,
                                            ol: ({ children }) => <ol className="list-decimal pl-5 space-y-1">{children}</ol>,
                                            li: ({ children }) => <li>{children}</li>,
                                            code: ({ children }) => (
                                                <code className="px-1.5 py-0.5 rounded bg-message-user text-[13px]">{children}</code>
                                            ),
                                            pre: ({ children }) => (
                                                <pre className="overflow-x-auto rounded-xl border border-border-custom p-3 bg-message-user text-[13px] leading-6">
                                                    {children}
                                                </pre>
                                            ),
                                            a: ({ href, children }) => (
                                                <a
                                                    href={href}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="underline decoration-text-muted hover:decoration-foreground"
                                                >
                                                    {children}
                                                </a>
                                            ),
                                            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                                        }}
                                    >
                                        {message.content}
                                    </ReactMarkdown>
                                    {message.sourceFragments && message.sourceFragments.length > 0 && (
                                        <div className="pt-2">
                                            <button
                                                onClick={() => setShowSources((prev) => !prev)}
                                                className="text-sm underline decoration-text-muted hover:decoration-foreground"
                                            >
                                                {showSources ? "Hide Sources" : "View Sources"}
                                            </button>
                                            {showSources && (
                                                <div className="mt-3 space-y-3 rounded-xl border border-border-custom p-3 bg-message-user/50">
                                                    {message.sourceFragments.map((fragment, index) => (
                                                        <div key={`${fragment.title}-${index}`} className="space-y-1">
                                                            <div className="text-sm font-medium">
                                                                {index + 1}. {fragment.title}
                                                            </div>
                                                            {fragment.url && (
                                                                <a
                                                                    href={fragment.url}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="text-xs underline decoration-text-muted hover:decoration-foreground break-all"
                                                                >
                                                                    {fragment.url}
                                                                </a>
                                                            )}
                                                            <p className="text-sm leading-6 text-text-muted">{fragment.excerpt}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        ) : (
                            <span className="inline-flex items-center gap-2 text-text-muted">
                                <span className="inline-block w-2.5 h-2.5 bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full" />
                                <span className="text-sm">{loadingLabel ?? "Thinking..."}</span>
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
