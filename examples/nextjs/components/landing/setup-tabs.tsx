'use client';

import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

import { ArrowRight } from '../icons';

export interface SetupStep {
  title: string;
  /** Highlighted code block HTML, built on the server. */
  code?: string;
  text?: string;
  link?: { href: string; label: string };
}

export interface SetupTab {
  id: string;
  label: string;
  summary: string;
  docs: { href: string; label: string };
  steps: SetupStep[];
}

/** Tabs per the WAI-ARIA pattern: arrow keys, Home and End move between them. */
export function SetupTabs({ tabs }: { tabs: SetupTab[] }) {
  const [selected, setSelected] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  const select = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    setSelected(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Partial<Record<string, number>> = {
      ArrowRight: selected + 1,
      ArrowLeft: selected - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div className="setup">
      <div
        role="tablist"
        aria-label="Setup for your stack"
        className="setup-tabs"
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[i] = element;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={i === selected}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={i === selected ? 0 : -1}
            className="setup-tab"
            onClick={() => {
              setSelected(i);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={i !== selected}
          className="setup-panel"
        >
          <p className="setup-summary">{tab.summary}</p>
          <ol className="setup-steps">
            {tab.steps.map((step, n) => (
              <li key={step.title} className="setup-step">
                <span className="setup-number" aria-hidden="true">
                  {n + 1}
                </span>
                <div className="setup-step-body">
                  <p className="setup-step-title">{step.title}</p>
                  {step.text ? (
                    <p className="setup-step-text">
                      {step.text}
                      {step.link ? (
                        <>
                          {' '}
                          <Link href={step.link.href}>{step.link.label}</Link>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {step.code ? <div dangerouslySetInnerHTML={{ __html: step.code }} /> : null}
                </div>
              </li>
            ))}
          </ol>
          <Link href={tab.docs.href} className="text-link">
            {tab.docs.label}
            <ArrowRight />
          </Link>
        </div>
      ))}
    </div>
  );
}
