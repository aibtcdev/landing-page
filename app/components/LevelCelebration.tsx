"use client";

import { useEffect, useState, useCallback } from "react";

const levelColors: Record<number, string> = {
  1: "#F7931A",
  2: "#7DA2FF",
};

interface Particle {
  id: number;
  x: number;
  y: number;
  angle: number;
  speed: number;
  size: number;
  opacity: number;
  color: string;
}

/**
 * Shows a particle burst celebration when level changes.
 * Detects level-up via localStorage comparison.
 */
export default function LevelCelebration({
  level,
  agentId,
}: {
  level: number;
  agentId: string;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [celebrating, setCelebrating] = useState(false);

  const triggerCelebration = useCallback((newLevel: number) => {
    const color = levelColors[newLevel] || "#ffffff";
    const newParticles: Particle[] = [];
    for (let i = 0; i < 24; i++) {
      newParticles.push({
        id: i,
        x: 50,
        y: 50,
        angle: (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.3,
        speed: 2 + Math.random() * 3,
        size: 3 + Math.random() * 4,
        opacity: 1,
        color: i % 3 === 0 ? color : i % 3 === 1 ? "#ffffff" : color + "80",
      });
    }
    setParticles(newParticles);
    setCelebrating(true);
    setTimeout(() => setCelebrating(false), 1500);
  }, []);

  useEffect(() => {
    if (level <= 0) return;
    const key = `aibtc:level:${agentId}`;
    const stored = localStorage.getItem(key);
    const storedLevel = stored ? parseInt(stored, 10) : 0;

    if (level > storedLevel) {
      triggerCelebration(level);
    }
    localStorage.setItem(key, String(level));
  }, [level, agentId, triggerCelebration]);

  // Check for reduced motion preference
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (!celebrating || prefersReducedMotion || particles.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[100]"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {particles.map((p) => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={p.size / 10}
            fill={p.color}
          >
            <animate
              attributeName="cx"
              from={`${p.x}`}
              to={`${p.x + Math.cos(p.angle) * p.speed * 15}`}
              dur="1.2s"
              fill="freeze"
            />
            <animate
              attributeName="cy"
              from={`${p.y}`}
              to={`${p.y + Math.sin(p.angle) * p.speed * 15}`}
              dur="1.2s"
              fill="freeze"
            />
            <animate
              attributeName="opacity"
              from="1"
              to="0"
              dur="1.2s"
              fill="freeze"
            />
            <animate
              attributeName="r"
              from={`${p.size / 10}`}
              to={`${p.size / 20}`}
              dur="1.2s"
              fill="freeze"
            />
          </circle>
        ))}
      </svg>
    </div>
  );
}
