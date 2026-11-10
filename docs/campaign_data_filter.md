## 1. Output columns (schema)

Keep only these columns, in this order. Drop everything else (event metadata, phones, hall/stall, address blocks, socials, products, secondary contacts, etc.):

```
company_name, company_clean, email, city, state, country, pincode,
contact_person_all, first_name, last_name, email_all, email_domain
```

Source values are left as-is (including literal `null`); only `company_clean`, `first_name`, `last_name` are computed.

---

## 2. Company name → `company_clean`

Create a cleaned company name next to the original.

1. Remove any parenthetical/bracketed content: `(A UNIT OF …)`, `(INDIA)`, `[…]`.
2. Remove legal-suffix and country tokens (case-insensitive, whole words):
   `Limited, Ltd, Pvt, Private, LLP, LLC, Inc, Incorporated, Corporation, Corp, Company, Co, PLC, GmbH, Pte, Sdn, Bhd, India`.
3. **Keep** industry/descriptor words (Textiles, Foods, International, Solutions…) and `&`.
4. Casing — **Title Case** (first letter of each word uppercase, rest lowercase), with an acronym exception applied **per word**:
   - If the source (minus parentheses) is **ALL CAPS**, re-case each word: normal words → Title Case (`AURO TEXTILES`→`Auro Textiles`, `ASHOK`→`Ashok`, `ADEKA`→`Adeka`).
   - **Keep a word UPPERCASE** when it's an acronym/initialism: length ≤ 2 (`GS`, `AS`, `MK`), OR length ≤ 5 with no vowels (`PDS`, `RSWM`), OR dotted initials (`A.K.`). → `GS TEXTILES`→`GS Textiles`, `3MB TECHNOLOGIES`→`3MB Technologies`.
   - If the source is **mixed case**, preserve the original token casing (`PDS Limited`→`PDS`).

Examples: `Arvind Limited`→`Arvind` · `COLORJET INDIA LIMITED`→`Colorjet` · `GS TEXTILES`→`GS Textiles` · `ASHOK & COMPANY PVT LTD`→`Ashok` · `A.TOSH ISHIMITSU BEVERAGES INDIA PRIVATE LIMITED`→`A.Tosh Ishimitsu Beverages`.

---

## 3. Name parsing → `first_name`, `last_name`

Source: `contact_person_all`.

1. **Multiple people** (comma-separated): use the **first person only**. Discard trailing role labels that follow a comma (`, Deputy Director`, `, Assistant Director`).
2. **Strip leading honorifics/titles**: `Mr, Mrs, Ms, Miss, Dr, Prof, Er, Eng, Shri, Sh, Sri, Smt, M/s, Capt, Adv` (with or without `.`).
3. **Skip name-prefixes** that are not the given name — take the **next** word as the first name:
   `Muhammad, Mohammad, Mohammed, Mohd, Md, Muhd, Abdul, Abdel, Abd`.
   (e.g. `Muhammad Rias` → first = **Rias**; `Abdul Hakeem` → first = **Hakeem**.)
4. **Skip leading single-letter initials** — take the first multi-letter word as the first name.
   (e.g. `T Senthil Kumar` → first = **Senthil**; `M Y S Amit …` → first = **Amit**.)
5. **Split glued initials**: `S.Muthukumaraswamy` → `S. Muthukumaraswamy` (a single initial glued to a name by a dot is separated, so the real name is picked as first). Pure initials with a space (`M.K. Sharma`, `R.K. Jain`) are **not** split.
6. `first_name` = that first real given-name word.
7. `last_name` = the words that come **after** the first-name word (may be empty).
8. **Casing** (both fields): Title Case — first letter of each word uppercase, rest lowercase (`PAVAN`→`Pavan`, `kumar jain`→`Kumar Jain`, `Ali Ali`→`Ali Ali`). **Keep initials/acronyms UPPERCASE**: dotted initials (`M.K. Sharma`→first `M.K.`), and short tokens ≤2 chars or ≤5-with-no-vowels (`GS`, `KC`, `GRG`).
9. If `contact_person_all` is **not a real person** — a company name (contains Pvt/Ltd/Foods/Industries/Creative/Minds/… or matches the company), a phone number, or `null`/empty — go to the **email fallback** (§4).

---

## 4. Email fallback for first name

When §3 yields no valid personal first name, look at the email:

1. Take the email local-part (before `@`). If it's a **clean personal name**, use it:
   - Split on `. _ -`. First alphabetic token → `first_name`; a following token → `last_name`. Title-cased (§3.8).
   - `krishna@…`→`Krishna`; `aniket.gulumbe@…`→`Aniket Gulumbe`.
   - **Reject** (not personal) if: the local-part contains digits, is a generic mailbox
     (`info, sales, marketing, contact, admin, enquiry, support, office, export, purchase, accounts, hr, order, business, reception, team, service, help, connect …`),
     equals/contains the company name (`creative_minds@creativeminds…`), the first token is < 3 chars, has no vowel, or is a company word (`industries, foods, exports, impex, group …`).
2. **If no clean personal name can be derived but the row HAS an email → `first_name` = `Team`** (last_name blank).
   This covers generic/company mailboxes: `info@`, `sales@`, `creative_minds@`, digit/mashup addresses. Used as a friendly greeting ("Hi Team,").
3. Only when there is **no email at all** → leave `first_name`/`last_name` blank.

---

## 5. Deduplication

- Remove exact duplicate rows.
- Remove duplicate **entries keyed on `email`** (lowercased): if rows share the same email, keep the one with the **most non-empty fields**; on a tie keep one.
- Rows with no/blank email are kept.

---

## 6. Notes

- These rules are applied programmatically for consistency (the manual reference sheet applied §4 and §5 only partially).
- Report after each run: input rows → output rows, how many names came from contact vs email vs left blank, and how many duplicate rows were removed.
