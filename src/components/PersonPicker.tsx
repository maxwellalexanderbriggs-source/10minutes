"use client";

import { useMemo, useState } from "react";
import { PEOPLE } from "../../shared/people";

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return row[b.length];
}

function scoreName(name: string, search: string) {
  if (!search) return 0;
  const candidate = normalize(name);
  const query = normalize(search);
  const words = query.split(" ").filter(Boolean);
  if (candidate === query) return -100;
  if (candidate.startsWith(query)) return -50;
  if (candidate.includes(query)) return -25 + candidate.indexOf(query);
  if (words.every((word) => candidate.includes(word))) return -10;
  const candidateWords = candidate.split(" ");
  return words.reduce(
    (total, word) =>
      total +
      Math.min(
        ...candidateWords.map((candidateWord) =>
          editDistance(word, candidateWord.slice(0, Math.max(word.length, 1))),
        ),
      ),
    0,
  );
}

type Props = {
  selected: string | null;
  disabled?: boolean;
  onSelect: (person: string) => Promise<void>;
};

export function PersonPicker({ selected, disabled, onSelect }: Props) {
  const [search, setSearch] = useState(selected ?? "");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const results = useMemo(() => {
    return [...PEOPLE]
      .map((person) => ({ person, score: scoreName(person, search) }))
      .sort((a, b) => a.score - b.score || a.person.localeCompare(b.person))
      .slice(0, search ? 10 : PEOPLE.length);
  }, [search]);

  async function choose(person: string) {
    setSearch(person);
    setOpen(false);
    setSaving(true);
    try {
      await onSelect(person);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="person-picker">
      <label className="sr-only">Choose a person</label>
      <input
        className="text-input picker-input"
        value={search}
        disabled={disabled || saving}
        placeholder="Search a name…"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => {
            setOpen(false);
            setSearch(selected ?? "");
          }, 120);
        }}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && open && results[0]) {
            event.preventDefault();
            void choose(results[0].person);
          }
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {saving && <span className="input-status">Saving…</span>}
      {open && !disabled && (
        <div className="picker-menu" role="listbox">
          {results.map(({ person }) => (
            <button
              type="button"
              role="option"
              aria-selected={selected === person}
              className="picker-option"
              key={person}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void choose(person)}
            >
              {person}
              {selected === person && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
