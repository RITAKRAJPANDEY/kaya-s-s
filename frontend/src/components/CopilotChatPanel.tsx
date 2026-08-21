"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, Mic, Loader2, Sparkles, User, Play, Square } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioBase64?: string;
}

export default function CopilotChatPanel() {
  const getBackendUrl = () => {
    if (typeof window !== "undefined") {
      const host = window.location.hostname || "localhost";
      return `http://${host}:8001`;
    }
    return "http://localhost:8001";
  };
  const visualizerCSS = `
    @keyframes pulse-ring {
      0% { transform: scale(0.8); opacity: 0.5; }
      50% { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(0.8); opacity: 0.5; }
    }
    @keyframes bar-bounce {
      0%, 100% { height: 4px; }
      50% { height: 16px; }
    }
  `;

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      role: "assistant",
      text: "I am Kaya, your AI Safety Copilot. I can see the video feed. What would you like to know?",
    }
  ]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const playAudio = (text: string) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => setIsPlaying(true);
      utterance.onend = () => setIsPlaying(false);
      utterance.onerror = () => setIsPlaying(false);
      window.speechSynthesis.speak(utterance);
    }
  };

  const stopAudio = () => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsPlaying(false);
  };

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        await handleSendVoice(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleSendVoice = async (audioBlob: Blob) => {
    setIsLoading(true);
    
    // Add a placeholder message for the user's voice input
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: "🎤 [Voice Message]",
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "voice.wav");

      const res = await fetch(`${getBackendUrl()}/api/ask`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error(`API Error: ${res.statusText}`);

      const data = await res.json();
      
      // Update the user message with the actual transcript
      setMessages((prev) => 
        prev.map(m => m.id === userMsg.id ? { ...m, text: data.transcript || "🎤 [Voice Message]" } : m)
      );

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: data.response,
        audioBase64: data.audio_base64 || undefined,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // Use native TTS to read the response out loud
      if (data.response) {
        playAudio(data.response);
      }
    } catch (error) {
      console.error("Voice chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          text: "Sorry, I couldn't process your voice message.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendText = async () => {
    if (!inputText.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      text: inputText.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("question", userMsg.text);

      // Call the backend text endpoint
      const res = await fetch(`${getBackendUrl()}/api/ask-text`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`API Error: ${res.statusText}`);
      }

      const data = await res.json();
      
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        text: data.response,
      };

      setMessages((prev) => [...prev, assistantMsg]);

      if (data.response) {
        playAudio(data.response);
      }
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          text: "Sorry, I encountered an error communicating with the backend. Please ensure the pipeline is running.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSendText();
    }
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      backgroundColor: "#ffffff",
      borderRadius: "var(--radius-lg, 12px)",
      border: "1px solid var(--border-light, #e2e8f0)",
      boxShadow: "var(--shadow-sm, 0 1px 2px 0 rgba(0,0,0,0.05))",
      overflow: "hidden",
      height: "100%",
    }}>
      <style>{visualizerCSS}</style>
      
      {/* Chat Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        backgroundColor: "#f8fafc",
        borderBottom: "1px solid #e2e8f0",
        flexShrink: 0
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ position: "relative" }}>
            <Sparkles size={16} style={{ color: "var(--emerald-primary, #10b981)" }} />
            {isPlaying && (
              <div style={{
                position: "absolute", top: -4, left: -4, right: -4, bottom: -4,
                border: "2px solid #10b981", borderRadius: "50%",
                animation: "pulse-ring 1.5s infinite"
              }} />
            )}
          </div>
          <h3 style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a", textTransform: "uppercase" }}>
            Kaya Multimodal Copilot
          </h3>
        </div>
        {isPlaying && (
          <button 
            onClick={stopAudio}
            style={{ 
              display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px", 
              backgroundColor: "#fee2e2", border: "1px solid #fca5a5", color: "#991b1b",
              borderRadius: "4px", fontSize: "10px", fontWeight: 700, cursor: "pointer"
            }}
          >
            <Square size={10} /> Stop Audio
          </button>
        )}
      </div>

      {/* Chat History */}
      <div style={{
        flex: 1,
        padding: "16px",
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        backgroundColor: "#ffffff"
      }}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "4px",
              flexDirection: msg.role === "user" ? "row-reverse" : "row"
            }}>
              <div style={{
                width: "20px", height: "20px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                backgroundColor: msg.role === "user" ? "#e2e8f0" : "#d1fae5",
                color: msg.role === "user" ? "#475569" : "#059669"
              }}>
                {msg.role === "user" ? <User size={12} /> : <Sparkles size={12} />}
              </div>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>
                {msg.role === "user" ? "You" : "Kaya"}
              </span>
            </div>
            
            <div style={{
              maxWidth: "85%",
              padding: "10px 14px",
              borderRadius: "12px",
              backgroundColor: msg.role === "user" ? "#0f172a" : "#f1f5f9",
              color: msg.role === "user" ? "#ffffff" : "#0f172a",
              fontSize: "13px",
              lineHeight: "1.5",
              borderBottomRightRadius: msg.role === "user" ? "4px" : "12px",
              borderBottomLeftRadius: msg.role === "assistant" ? "4px" : "12px",
            }}>
              {msg.text}
              {msg.role === "assistant" && !isPlaying && (
                 <div style={{ marginTop: "8px" }}>
                   <button 
                     onClick={() => playAudio(msg.text)}
                     style={{
                       display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px",
                       backgroundColor: "#e2e8f0", border: "none", borderRadius: "4px", cursor: "pointer",
                       fontSize: "10px", fontWeight: 600, color: "#334155"
                     }}
                   >
                     <Play size={10} /> Read Aloud
                   </button>
                 </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#64748b" }}>
            <Loader2 size={14} className="animate-spin" />
            <span style={{ fontSize: "12px", fontStyle: "italic" }}>Kaya is processing...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={{
        padding: "12px",
        backgroundColor: "#f8fafc",
        borderTop: "1px solid #e2e8f0",
        flexShrink: 0
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: isRecording ? "#fef2f2" : "#ffffff",
          border: `1px solid ${isRecording ? "#fca5a5" : "#cbd5e1"}`,
          borderRadius: "24px",
          padding: "6px 12px",
          transition: "all 0.2s"
        }}>
          <button 
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            style={{
            background: isRecording ? "#ef4444" : "none", 
            border: "none", 
            color: isRecording ? "#ffffff" : "#64748b", 
            cursor: "pointer", 
            padding: "8px",
            borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s",
            boxShadow: isRecording ? "0 0 10px rgba(239, 68, 68, 0.5)" : "none"
          }}>
            <Mic size={16} />
          </button>

          {isRecording ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "4px", height: "24px" }}>
              <div style={{ width: "4px", backgroundColor: "#ef4444", borderRadius: "2px", animation: "bar-bounce 1s infinite 0.1s" }} />
              <div style={{ width: "4px", backgroundColor: "#ef4444", borderRadius: "2px", animation: "bar-bounce 1s infinite 0.3s" }} />
              <div style={{ width: "4px", backgroundColor: "#ef4444", borderRadius: "2px", animation: "bar-bounce 1s infinite 0.2s" }} />
              <div style={{ width: "4px", backgroundColor: "#ef4444", borderRadius: "2px", animation: "bar-bounce 1s infinite 0.4s" }} />
              <div style={{ width: "4px", backgroundColor: "#ef4444", borderRadius: "2px", animation: "bar-bounce 1s infinite 0.1s" }} />
              <span style={{ fontSize: "12px", fontWeight: 700, color: "#ef4444", marginLeft: "12px" }}>Listening...</span>
            </div>
          ) : (
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Kaya about the scene..."
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                fontSize: "13px",
                backgroundColor: "transparent",
                color: "#0f172a"
              }}
              disabled={isLoading}
            />
          )}

          {!isRecording && (
            <button 
              onClick={handleSendText}
              disabled={isLoading || !inputText.trim()}
              style={{
              background: inputText.trim() ? "var(--emerald-primary, #10b981)" : "#e2e8f0", 
              border: "none", 
              color: inputText.trim() ? "#ffffff" : "#94a3b8", 
              cursor: inputText.trim() ? "pointer" : "not-allowed", 
              padding: "6px",
              borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.2s"
            }}>
              <Send size={14} style={{ marginLeft: "2px" }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
