# Lesson File Format (schema_version 1)

This document defines the files you can import in the **Import** tab. It is written so you can paste it
into an AI tool together with a transcript or word list and ask it to produce a lesson file.

Supported files: `.yaml` / `.yml` (recommended), `.json`, `.csv` (vocabulary only).
One file = one lesson. Importing a file whose lesson `id` already exists **updates** that lesson.

---

## How words and sentences work together

The app assumes you know **no** vocabulary beyond very basic function words. So each lesson has two stages:

1. **Words** – every item that is not `kind: sentence` (nouns, verbs, adjectives, phrases …) is learned first, in the order you list them (put the most useful first).
2. **Sentences** – example sentences, `kind: sentence` items and all `exercises` unlock once **80 %** of the words are learned (you can also unlock manually).

**Authoring rule: every content word used in a sentence or exercise must also be an item.**
Articles, pronouns and basic auxiliaries (ich, du, der, die, ein, und, ist, hat, möchte …) are exempt. When you import, the app warns:
`Words used in sentences but missing from items: Kaffee, müde …`. Add those words as items.

Inflected forms are recognised automatically for regular words (plural, `-e/-st/-t/-en`, `ge…t`, adjective endings).
For irregular forms, list them so they are found: `forms: { er: isst, perfekt: hat gegessen }`.

---

## 1. YAML / JSON lesson

### Top level

| Field            | Required | Type            | Notes |
|------------------|----------|-----------------|-------|
| `schema_version` | no       | integer         | Use `1`. Files with a higher number are rejected. |
| `id`             | **yes**  | string          | Unique, stable lesson id. Only letters, digits, `_`, `.`, `-` (no spaces). e.g. `yt-bakery-01` |
| `title`          | **yes**  | string          | Shown in the app. |
| `tags`           | no       | list of strings | e.g. `[video, a1, food]` |
| `source`         | no       | string          | Free note for yourself (e.g. a video URL). |
| `items`          | no       | list            | Vocabulary / phrases (section 1.1). |
| `exercises`      | no       | list            | Sentence exercises (section 1.2). |

A lesson may contain only `items`, only `exercises`, or both.

### 1.1 Items (vocabulary, phrases, sentences)

| Field     | Required | Type   | Notes |
|-----------|----------|--------|-------|
| `de`      | **yes**  | string | The German word/phrase. Include nothing else (no article here, see `article`). |
| `en`      | **yes**  | string | English meaning. |
| `kind`    | no       | one of `noun`, `verb`, `adjective`, `adverb`, `phrase`, `sentence`, `other` | Default `other`. |
| `article` | no       | `der` \| `die` \| `das` | Nouns only. A noun without an article gives a warning. |
| `plural`  | no       | string | Plural form without article, e.g. `Brote`. |
| `example` | no       | object | `de` (required inside) and optional `en`. One example sentence. |
| `forms`   | no       | map of string → string | Free-form extras, e.g. `er: bestellt`, `perfekt: hat bestellt`. |
| `tts`     | no       | string | Text to **speak** if it should differ from `de` (e.g. drop "…", fix a mispronunciation). |
| `notes`   | no       | string | Any note shown with the item. |
| `id`      | no       | string | Normally leave out. It is derived from `de` (`Brötchen` → `broetchen`). **Needed only** when two items have the same `de` (e.g. two meanings of "Bank"). |

**Progress is attached to the item id.** If you later edit the `de` text of an item, it counts as a new
item and its progress resets. To fix typos in `de` without losing progress, give the item an explicit `id`
from the start.

Example:

```yaml
items:
  - kind: noun
    de: Brot
    article: das
    plural: Brote
    en: bread
    example: { de: "Ich hätte gern ein Brot.", en: "I would like a loaf of bread." }
  - kind: verb
    de: bestellen
    en: to order
    forms: { er: bestellt, perfekt: hat bestellt }
  - kind: phrase
    de: Ich hätte gern …
    en: I would like …
    tts: Ich hätte gern
  - id: bank-money           # needed: another item also has de: Bank
    kind: noun
    de: Bank
    article: die
    plural: Banken
    en: bank (money)
```

### 1.2 Exercises

Every exercise has a `type` plus the fields for that type. Common optional fields on all types:

- `explanation` – shown after answering (put your grammar explanation here).
- `hint` – shown on request.
- `id` – normally leave out (generated from the content).

#### `fill_blank`

| Field    | Required | Notes |
|----------|----------|-------|
| `prompt` | yes | Must contain `___` (three underscores) where the gap is. |
| `answer` | yes | The correct text for the gap. |
| `accept` | no  | List of other accepted answers (alternative spellings, synonyms). |

```yaml
- type: fill_blank
  prompt: "Ich ___ gern ein Brot."
  answer: hätte
  accept: [haette]
  hint: "Konjunktiv II of haben"
  explanation: "'Ich hätte gern' is the polite way to order."
```

#### `word_order`

| Field       | Required | Notes |
|-------------|----------|-------|
| `tokens`    | yes (≥ 2) | The words shown scrambled. Write them exactly as they appear in the answer, including capitalization and any attached punctuation. |
| `answers`   | yes (≥ 1) | **Every** acceptable full sentence. German word order is flexible, so list all valid orders. |
| `prompt_en` | no  | English meaning shown as a clue. |

The importer warns if an answer's words do not exactly match `tokens`.

```yaml
- type: word_order
  prompt_en: "Because I am tired, I sleep."
  tokens: ["Weil", "ich", "müde", "bin,", "schlafe", "ich."]
  answers:
    - "Weil ich müde bin, schlafe ich."
  explanation: "'weil' sends the conjugated verb to the end of its clause."
```

(Quote the tokens; the comma stays attached to `"bin,"` and the full stop to `"ich."` so the token list matches the answer.)

#### `translate`

English prompt → the learner types German.

| Field     | Required | Notes |
|-----------|----------|-------|
| `prompt`  | yes | English sentence. |
| `answers` | yes (≥ 1) | All acceptable German translations. |

```yaml
- type: translate
  prompt: "Because I am hungry, I order bread."
  answers:
    - "Weil ich Hunger habe, bestelle ich Brot."
    - "Ich bestelle Brot, weil ich Hunger habe."
```

#### `multiple_choice`

| Field     | Required | Notes |
|-----------|----------|-------|
| `prompt`  | yes | The question. |
| `options` | yes (≥ 2) | Answer choices. |
| `correct` | yes | **0-based** index into `options` (first option = `0`). |

```yaml
- type: multiple_choice
  prompt: "Which sentence is correct?"
  options: ["Weil ich bin müde, schlafe ich.", "Weil ich müde bin, schlafe ich."]
  correct: 1
  explanation: "Subordinating conjunctions push the verb to the end."
```

### 1.3 YAML pitfalls (important when an AI writes the file)

- **Quote any string containing `:` , `#`, a leading `-`, or starting with `[ { * & ! % @`.**
  When in doubt, wrap strings in double quotes.
- Inside inline `{ ... }` or `[ ... ]` a **comma ends the value** unless the value is quoted:
  `example: { de: "Zwei Brötchen, bitte.", en: "Two rolls, please." }`.
- **Always quote `word_order` tokens** that carry punctuation: `["Weil", "ich", "müde", "bin,", "schlafe", "ich."]`. An unquoted `bin,,` is a YAML error.
- Indent with spaces, never tabs.
- Unknown extra fields are ignored silently, so **spelling of field names matters** (`example`, not `examples`).
- JSON is also accepted (JSON is valid YAML), but YAML is easier to read and allows `#` comments.

---

## 2. CSV (vocabulary only)

- First row is the header. Column order is free; names are case-insensitive.
- Separator: comma, or semicolon (auto-detected from the header row; handy for German-locale spreadsheets).
- Quote fields containing the separator or line breaks with `"`; escape a quote as `""`.
- Lesson `id` and `title` come from the **file name** (`everyday-expressions.csv` → id `everyday-expressions`).
- CSV cannot define exercises. Use YAML for those.

| Column       | Required | Meaning |
|--------------|----------|---------|
| `de`         | **yes**  | German word/phrase |
| `en`         | **yes**  | English meaning |
| `kind`       | no       | `noun`, `verb`, `adjective`, `adverb`, `phrase`, `sentence`, `other` |
| `article`    | no       | `der`, `die`, `das` |
| `plural`     | no       | plural form |
| `example_de` | no       | example sentence (German) |
| `example_en` | no       | example sentence (English; only used if `example_de` is set) |
| `tts`        | no       | text to speak if different from `de` |
| `notes`      | no       | free note |

```csv
de,en,kind,article,plural,example_de,example_en
Brot,bread,noun,das,Brote,"Ich hätte gern ein Brot.","I would like a loaf of bread."
bestellen,to order,verb,,,"Ich bestelle einen Kaffee.","I order a coffee."
```

---

## 3. What happens on import

1. The file is parsed and validated. **If anything is invalid, nothing is imported**; the errors name the field and line, e.g. `items[0].article: Invalid option … (line 6)`.
2. A preview shows the lesson title, item/exercise counts and any warnings.
3. On confirm it is saved. Re-importing the same lesson `id`:
   - updates changed items/exercises in place,
   - keeps study progress for items whose id is unchanged,
   - removes items/exercises no longer in the file (and their progress).
4. If `tts-service` is running, audio for all words (or `tts` overrides), example sentences and exercise answers is generated in advance with the selected voice (Piper or Edge).

---

## 4. Ready-to-paste prompt for your AI tool

> You are preparing a German lesson file for my learning app. Follow the format in the attached
> `LESSON_FORMAT.md` exactly and output **only** one YAML document (no commentary).
>
> Source material: *<paste transcript / word list / topic>*
>
> Requirements:
> - `id`: `<short-stable-id>`, `title`: `<title>`, `tags`: `[<tags>]`, level A1/A2.
> - `items`: the ~`<N>` most useful words/phrases from the material, most basic first. **Every content word (noun, verb, adjective, adverb) that appears in any example sentence or exercise must also be its own item**; only articles, pronouns and basic auxiliaries may be left out. For irregular verbs add `forms`. For every noun give `article` and `plural`. Add one short, natural `example` sentence (`de` + `en`) per item. Use `kind` correctly. Use `tts` only where `de` contains symbols such as `…` or `(`.
> - `exercises`: about `<M>` exercises mixing `fill_blank`, `word_order`, `translate`, `multiple_choice`, focused on `<grammar focus, e.g. weil / dass verb-final, V2 word order>`. Every exercise needs a short `explanation` in English. For `word_order` and `translate`, list **all** natural correct variants in `answers`.
> - Quote every string that contains a comma, colon or `#`. Use spaces for indentation. Double-check that `multiple_choice.correct` is a 0-based index and that every `fill_blank.prompt` contains `___`.
> - Do not invent vocabulary that is not appropriate for the level; keep sentences simple and correct.

---

## 5. Complete minimal example

```yaml
schema_version: 1
id: yt-bakery-01
title: "Easy German – At the bakery"
tags: [video, a1, food]

items:
  - { kind: noun, de: Brot, article: das, plural: Brote, en: bread }
  - kind: phrase
    de: Ich hätte gern …
    en: I would like …
    tts: Ich hätte gern

exercises:
  - type: fill_blank
    prompt: "Ich ___ gern ein Brot."
    answer: hätte
    explanation: "Polite ordering uses Konjunktiv II."
  - type: translate
    prompt: "Because I am hungry, I order bread."
    answers:
      - "Weil ich Hunger habe, bestelle ich Brot."
      - "Ich bestelle Brot, weil ich Hunger habe."
```

A larger working sample is in `sample-lessons/bakery-vocab.yaml`, and a CSV sample in
`sample-lessons/everyday-expressions.csv`.
