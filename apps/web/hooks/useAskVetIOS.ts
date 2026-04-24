'use client';

import { useCallback } from 'react';
import { useChatStore } from '@/store/useChatStore';

export type SmartActionType =
  | 'run_diagnosis'
  | 'view_diagnostics'
  | 'research_mode'
  | 'exam_notes'
  | 'pathogenesis'
  | 'molecular_basis'
  | 'prevention'
  | 'vaccine_info'
  | 'run_inference'
  | 'suggest_tests'
  | 'explain_condition'
  | 'pathophysiology'
  | 'lab_interpretation';

// Maps each button action to a prompt injected into the chat
const ACTION_PROMPTS: Record<SmartActionType, (context: string) => string> = {
  run_diagnosis:      (ctx) => `Run a full clinical differential diagnosis for: ${ctx}. List all likely differentials ranked by probability with supporting clinical reasoning.`,
  view_diagnostics:   (ctx) => `What diagnostic tests and imaging would you order to investigate ${ctx}? Include the reasoning for each test and what findings you expect.`,
  research_mode:      (ctx) => `Provide a comprehensive research-level scientific overview of ${ctx}. Include molecular mechanisms, current research findings, and emerging developments.`,
  exam_notes:         (ctx) => `Create concise veterinary exam revision notes for ${ctx}. Format as bullet points suitable for studying. Include: definition, aetiology, pathogenesis, clinical signs, diagnosis, treatment, prognosis.`,
  pathogenesis:       (ctx) => `Explain in detail the complete pathogenesis of ${ctx} — from initial infection/trigger through to the final clinical presentation. Include cellular and molecular mechanisms.`,
  molecular_basis:    (ctx) => `Describe the molecular and cellular basis of ${ctx}. Include relevant proteins, receptors, signalling pathways, genetic factors, and molecular targets for treatment.`,
  prevention:         (ctx) => `What are the evidence-based prevention and control strategies for ${ctx}? Include vaccination protocols, biosecurity measures, surveillance, and public health considerations.`,
  vaccine_info:       (ctx) => `Provide complete information about vaccines available for ${ctx}. Include: vaccine types, manufacturers, vaccination schedules, efficacy data, adverse effects, and contraindications.`,
  run_inference:      (ctx) => `Analyse the following clinical case and produce a ranked differential diagnosis: ${ctx}`,
  suggest_tests:      (ctx) => `What laboratory tests, imaging, and diagnostic workup would you recommend for ${ctx}? Prioritise by clinical utility and include expected findings.`,
  explain_condition:  (ctx) => `Provide a thorough explanation of ${ctx} suitable for a veterinary professional — covering aetiology, pathophysiology, clinical presentation, and management.`,
  pathophysiology:    (ctx) => `Walk through the complete pathophysiology of ${ctx} step by step, explaining how the disease process leads to each clinical sign observed.`,
  lab_interpretation: (ctx) => `Interpret the following laboratory findings in the context of ${ctx}. Explain what each abnormality indicates and how it supports or refutes specific diagnoses.`,
};

// Extract the subject/context from recent messages in the chat
function extractContext(messages: Array<{ role: string; content: string }>): string {
  // Get the last meaningful assistant or user message topic
  const recent = [...messages].reverse().slice(0, 4);
  for (const msg of recent) {
    const content = msg.content.trim();
    if (content.length > 10) {
      // Strip markdown, take first meaningful line
      const firstLine = content
        .replace(/^#+\s*/gm, '')
        .replace(/\*\*/g, '')
        .split('\n')
        .find(l => l.trim().length > 15);
      if (firstLine) return firstLine.slice(0, 120);
    }
  }
  return 'the current case';
}

export function useAskVetIOS() {
  const { activeChatId, addMessage, setLoading, chats } = useChatStore();

  const sendMessage = useCallback(async (content: string) => {
    if (!activeChatId) return;

    addMessage(activeChatId, { role: 'user', content });
    setLoading(true);

    try {
      const res = await fetch('/api/ask-vetios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: content }),
      });
      const data = await res.json() as {
        content?: string;
        metadata?: Record<string, unknown>;
        error?: string;
      };

      if (data.error) throw new Error(data.error);

      addMessage(activeChatId, {
        role: 'assistant',
        content: data.content ?? 'No response received.',
        metadata: data.metadata as Parameters<typeof addMessage>[1]['metadata'],
      });
    } catch (err) {
      addMessage(activeChatId, {
        role: 'assistant',
        content: `⚠️ Intelligence gateway error: ${err instanceof Error ? err.message : 'Unknown error'}. Please retry.`,
      });
    } finally {
      setLoading(false);
    }
  }, [activeChatId, addMessage, setLoading]);

  const handleAction = useCallback((action: SmartActionType) => {
    if (!activeChatId) return;

    // Get context from current chat messages
    const activeChat = chats.find(c => c.id === activeChatId);
    const messages = activeChat?.messages ?? [];
    const context = extractContext(messages);

    const promptFn = ACTION_PROMPTS[action];
    if (!promptFn) return;

    const prompt = promptFn(context);
    void sendMessage(prompt);
  }, [activeChatId, chats, sendMessage]);

  return { sendMessage, handleAction };
}
