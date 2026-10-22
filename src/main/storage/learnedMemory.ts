import crypto from 'crypto';
import { JsonStore } from './jsonStore';
import type { Plan, SafeAction } from '../../shared/action';
import type { ConversationTurn } from './conversationStore';

export interface LearnedEntry {
  id: string;
  query: string;
  normalizedQuery: string;
  tokens: string[];
  reply: string;
  actionPlan?: {
    summary: string;
    steps: SafeAction[];
  };
  usageCount: number;
  lastUsedAt: string;
  createdAt: string;
  verifiedSuccess: boolean;
}

export interface LearnedMemoryStats {
  totalLearned: number;
  frequentlyUsed: Array<{ query: string; reply: string; count: number }>;
}

const FILLER_WORDS = new Set([
  'please', 'pls', 'can', 'you', 'could', 'would', 'kindly', 'raphael',
  'hey', 'hello', 'hi', 'um', 'uh', 'just', 'i', 'want', 'to'
]);

export function normalizeQuery(raw: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip common conversational fillers
  const tokens = clean
    .split(' ')
    .filter((w) => w && !FILLER_WORDS.has(w));

  return tokens.join(' ');
}

export function tokenize(raw: string): string[] {
  const norm = normalizeQuery(raw);
  return norm ? norm.split(' ') : [];
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;

  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export class LearnedMemoryStore {
  private readonly store: JsonStore<LearnedEntry[]>;

  constructor(dataDir: string) {
    this.store = new JsonStore<LearnedEntry[]>(dataDir, 'learned-memory.json', []);
  }

  /**
   * Fast lookup: checks if My Liege's question or command has been learned
   * from past conversations with high confidence.
   */
  match(userText: string): LearnedEntry | null {
    const raw = userText.trim();
    if (!raw) return null;

    const norm = normalizeQuery(raw);
    if (!norm) return null;

    const queryTokens = tokenize(raw);
    const list = this.store.read();

    // 1. Direct exact match on normalized form
    for (const item of list) {
      if (item.normalizedQuery === norm) {
        this.bumpUsage(item.id);
        return item;
      }
    }

    // 2. High token-similarity match (e.g. 80%+ Jaccard similarity)
    let bestMatch: LearnedEntry | null = null;
    let highestSim = 0.80;

    for (const item of list) {
      const sim = jaccardSimilarity(queryTokens, item.tokens);
      if (sim > highestSim) {
        highestSim = sim;
        bestMatch = item;
      }
    }

    if (bestMatch) {
      this.bumpUsage(bestMatch.id);
      return bestMatch;
    }

    return null;
  }

  /**
   * Learns a completed turn and caches the response / action plan for instant future reuse.
   */
  learn(userText: string, plan: Plan, verifiedSuccess = true): void {
    const raw = userText.trim();
    if (!raw) return;

    // Don't learn error or refusal replies
    if (!plan.summary || plan.summary.includes('failed') || plan.summary.includes("couldn't get a read")) {
      return;
    }

    const norm = normalizeQuery(raw);
    if (!norm || norm.length < 2) return;

    const tokens = tokenize(raw);
    const list = this.store.read();
    const now = new Date().toISOString();

    const existingIndex = list.findIndex((item) => item.normalizedQuery === norm);

    if (existingIndex !== -1) {
      const item = list[existingIndex];
      item.usageCount += 1;
      item.lastUsedAt = now;
      item.verifiedSuccess = verifiedSuccess;
      item.reply = plan.summary;
      if (plan.steps.length > 0) {
        item.actionPlan = { summary: plan.summary, steps: plan.steps };
      }
      this.store.write(list);
      return;
    }

    const newEntry: LearnedEntry = {
      id: crypto.randomUUID(),
      query: raw,
      normalizedQuery: norm,
      tokens,
      reply: plan.summary,
      actionPlan: plan.steps.length > 0 ? { summary: plan.summary, steps: plan.steps } : undefined,
      usageCount: 1,
      lastUsedAt: now,
      createdAt: now,
      verifiedSuccess
    };

    list.push(newEntry);
    // Keep up to 1000 learned entries
    if (list.length > 1000) {
      // Sort by usage count and recency, drop the lowest
      list.sort((a, b) => b.usageCount - a.usageCount || b.lastUsedAt.localeCompare(a.lastUsedAt));
      list.splice(1000);
    }
    this.store.write(list);
  }

  /**
   * "Study" method: analyzes recent conversation logs & daily journal turns,
   * extracting verified Q&A pairs and frequent commands into fast-response memory.
   */
  studyHistory(turns: ConversationTurn[]): { studiedCount: number; newLearned: number } {
    let newLearned = 0;
    const list = this.store.read();
    const existingNorms = new Set(list.map((l) => l.normalizedQuery));

    for (const turn of turns) {
      const userText = (turn.userText || '').trim();
      const reply = (turn.reply || '').trim();
      if (!userText || !reply) continue;

      // Ignore errors or unhelpful fallbacks
      if (reply.includes("couldn't get a read") || reply.includes('failed to reach me') || reply.includes('failed')) {
        continue;
      }

      const norm = normalizeQuery(userText);
      if (!norm || norm.length < 2) continue;

      if (existingNorms.has(norm)) {
        // Find and bump usage
        const item = list.find((i) => i.normalizedQuery === norm);
        if (item) item.usageCount += 1;
        continue;
      }

      const entry: LearnedEntry = {
        id: crypto.randomUUID(),
        query: userText,
        normalizedQuery: norm,
        tokens: tokenize(userText),
        reply,
        usageCount: 1,
        lastUsedAt: turn.timestamp || new Date().toISOString(),
        createdAt: turn.timestamp || new Date().toISOString(),
        verifiedSuccess: true
      };

      list.push(entry);
      existingNorms.add(norm);
      newLearned++;
    }

    if (newLearned > 0) {
      this.store.write(list);
    }

    return {
      studiedCount: turns.length,
      newLearned
    };
  }

  private bumpUsage(id: string): void {
    const list = this.store.read();
    const item = list.find((i) => i.id === id);
    if (item) {
      item.usageCount += 1;
      item.lastUsedAt = new Date().toISOString();
      this.store.write(list);
    }
  }

  getStats(): LearnedMemoryStats {
    const list = this.store.read();
    const sorted = [...list].sort((a, b) => b.usageCount - a.usageCount);
    return {
      totalLearned: list.length,
      frequentlyUsed: sorted.slice(0, 10).map((i) => ({ query: i.query, reply: i.reply, count: i.usageCount }))
    };
  }

  clear(): void {
    this.store.write([]);
  }
}
