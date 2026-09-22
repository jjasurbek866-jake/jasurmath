"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MessageBubble } from "@/components/MessageBubble";
import { streamChat } from "@/lib/chat-client";
import { parseReply } from "@/lib/options";
import { getInitData, hapticTap, initWebApp } from "@/lib/telegram-client";
import {
  KICKOFF_MESSAGE,
  MAX_MESSAGE_CHARS,
  type ChatMessage,
} from "@/lib/types";

const STORAGE_KEY = "jasurmath.chat.v1";

/** Har doim ko'rinib turadigan tezkor amallar. */
const QUICK_ACTIONS = [
  "Rejamni ko'rsat",
  "Mashq ber",
  "Boshqacha tushuntir",
] as const;

interface UiMessage extends ChatMessage {
  id: string;
  /** Modelga yuboriladi, lekin ekranda ko'rinmaydi (masalan birinchi turtki). */
  hidden?: boolean;
}

export function Chat() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Xato bo'lgan so'rov - "Qayta urinish" tugmasi shuni qayta yuboradi. */
  const [retry, setRetry] = useState<{
    text: string;
    hidden: boolean;
    /** Yiqilgan so'rovning xabari - qayta urinishda tarixdan olib tashlanadi. */
    fromId: string;
  } | null>(null);

  const startedRef = useRef(false);
  const messagesRef = useRef<UiMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  messagesRef.current = messages;

  const send = useCallback(async (text: string, hidden = false) => {
    const trimmed = text.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!trimmed) return;

    setError(null);
    setRetry(null);
    setBusy(true);

    const userMessage: UiMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
      hidden,
    };
    const assistantId = createId();
    const history = [...messagesRef.current, userMessage];

    setMessages([
      ...history,
      { id: assistantId, role: "assistant", content: "" },
    ]);

    let answer = "";
    const controller = new AbortController();

    try {
      await streamChat({
        messages: history.map(({ role, content }) => ({ role, content })),
        initData: getInitData(),
        signal: controller.signal,
        onText(chunk) {
          answer += chunk;
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? { ...message, content: answer }
                : message,
            ),
          );
        },
      });

      if (!answer.trim()) throw new Error("Javob bo'sh keldi.");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Nimadir noto'g'ri ketdi. Qayta urinib ko'r.",
      );
      // So'rovni eslab qolamiz - foydalanuvchi savolini qayta yozmasin.
      setRetry({ text: trimmed, hidden, fromId: userMessage.id });
      // Hech narsa kelmagan bo'lsa bo'sh "pufakcha" qolmasin. Chala javob
      // kelgan bo'lsa ekranda qoladi - foydalanuvchi o'qiy oladi; tarixdan
      // esa qayta urinish paytida tozalanadi.
      if (!answer.trim()) {
        setMessages((prev) =>
          prev.filter(
            (message) =>
              message.id !== assistantId && message.id !== userMessage.id,
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  }, []);

  // Ochilganda: Telegram bilan bog'lanish + saqlangan suhbatni tiklash.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      // Telegram SDK yuklanguncha kutamiz, keyingina birinchi so'rov ketadi.
      await initWebApp();

      const saved = loadMessages();
      if (saved.length > 0) {
        setMessages(saved);
        return;
      }
      void send(KICKOFF_MESSAGE, true);
    })();
  }, [send]);

  // Suhbatni saqlab boramiz (oqim tugagandan keyin).
  useEffect(() => {
    if (busy || messages.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // xotira to'lgan yoki bloklangan - suhbat baribir ishlayveradi
    }
  }, [messages, busy]);

  // Har yangi bo'lakdan keyin pastga tushamiz.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  const handleSubmit = () => {
    if (busy || !input.trim()) return;
    hapticTap();
    const text = input;
    setInput("");
    resetTextareaHeight();
    void send(text);
  };

  const handleChip = (option: string) => {
    if (busy) return;
    hapticTap();
    void send(option);
  };

  const resetConversation = () => {
    if (busy) return;
    hapticTap();
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // e'tiborsiz
    }
    setMessages([]);
    setError(null);
    void send(KICKOFF_MESSAGE, true);
  };

  const resetTextareaHeight = () => {
    const node = textareaRef.current;
    if (node) node.style.height = "auto";
  };

  const lastMessage = messages.at(-1);
  const suggestions =
    !busy && lastMessage?.role === "assistant"
      ? parseReply(lastMessage.content).options
      : [];

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-logo" aria-hidden="true">
            JM
          </div>
          <div>
            <div className="brand-name">JasurMath</div>
            <div className="brand-sub">Matematika - noldan boshlab</div>
          </div>
        </div>
        <button
          type="button"
          className="reset-button"
          onClick={resetConversation}
          disabled={busy}
        >
          Yangi suhbat
        </button>
      </header>

      <div className="messages" ref={scrollRef}>
        {messages
          .filter((message) => !message.hidden)
          .map((message) => (
            <MessageBubble
              key={message.id}
              role={message.role}
              content={
                message.role === "assistant"
                  ? parseReply(message.content).body
                  : message.content
              }
            />
          ))}
        {error && (
          <div className="error">
            <div>{error}</div>
            {retry && !busy && (
              <button
                type="button"
                className="retry-button"
                onClick={() => {
                  hapticTap();
                  const again = retry;
                  setRetry(null);
                  setError(null);
                  // Yiqilgan so'rov va uning chala javobini tarixdan olib
                  // tashlaymiz, aks holda savol ikki marta takrorlanadi.
                  const index = messagesRef.current.findIndex(
                    (m) => m.id === again.fromId,
                  );
                  if (index !== -1) {
                    const trimmed = messagesRef.current.slice(0, index);
                    // send() tarixni ref'dan o'qiydi, setMessages esa darrov
                    // ta'sir qilmaydi - shuning uchun ref ham yangilanadi.
                    messagesRef.current = trimmed;
                    setMessages(trimmed);
                  }
                  void send(again.text, again.hidden);
                }}
              >
                Qayta urinish
              </button>
            )}
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="chips">
          {suggestions.map((option) => (
            <button
              key={option}
              type="button"
              className="chip"
              onClick={() => handleChip(option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <div className="chips chips-quick">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action}
            type="button"
            className="chip"
            onClick={() => handleChip(action)}
            disabled={busy}
          >
            {action}
          </button>
        ))}
      </div>

      <div className="composer">
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          placeholder="Savolingni yoz..."
          maxLength={MAX_MESSAGE_CHARS}
          onChange={(event) => {
            setInput(event.target.value);
            const node = event.target;
            node.style.height = "auto";
            node.style.height = `${Math.min(node.scrollHeight, 120)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSubmit();
            }
          }}
        />
        <button
          type="button"
          className="send-button"
          onClick={handleSubmit}
          disabled={busy || !input.trim()}
          aria-label="Yuborish"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.4 20.4 21.85 12.5a.6.6 0 0 0 0-1.1L3.4 3.6a.6.6 0 0 0-.83.68L4.2 11.2c.05.24.25.42.5.45l9.1 1.1a.25.25 0 0 1 0 .5l-9.1 1.1a.6.6 0 0 0-.5.45l-1.63 6.92a.6.6 0 0 0 .83.68Z" />
    </svg>
  );
}

function loadMessages(): UiMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isUiMessage);
  } catch {
    return [];
  }
}

function isUiMessage(value: unknown): value is UiMessage {
  if (typeof value !== "object" || value === null) return false;
  const { id, role, content } = value as Partial<UiMessage>;
  return (
    typeof id === "string" &&
    (role === "user" || role === "assistant") &&
    typeof content === "string"
  );
}

function createId(): string {
  return Math.random().toString(36).slice(2, 11);
}
