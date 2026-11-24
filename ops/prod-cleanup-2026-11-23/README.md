# Cleaning test data out of the production database (prepared 2026-11-23)

## What was found (read-only investigation on copies)
A test suite was run against the production database before the tests were isolated. The production file holds:

| Group | Records | Evidence |
|---|---|---|
| `TEST_` journal entries | 11 entries, 20 lines | dated 2027–2028; posted to the wrong accounts because the old test used old chart codes (furniture −370,000, start-up costs +600,000, revenue +700,000) |
| Test accounting periods | 7 | five «فترة رقابية اختبارية» periods overlap the real Q1 2025; two closed test months in 2033 / 2034 block posting |
| `RC-CHAIN-` receipts | 4 | the client-chain test; their client and project do not exist |
| Test supplier, `test_key` setting, 3 profitability-test audit rows | 5 | named by the tests |
| `REC-MNR-001/002` receipts (optional) | 2 (45,000,000) | demo receipts for a client and project that do not exist |
| Entries with no source document (optional) | 7 | `JE-00009` accrues a bill that does not exist (and has no lines); six inventory entries were created within 3 seconds on 2026-10-17 while the items table is empty |
| `RC-2026-0001` (your decision) | 1 receipt, 1 entry, 1 cash row | 1,000,000 recorded as a client collection, but its entry is bank-to-bank (Dr الكريمي / Cr القطيبي); it is what makes the client show −900,000 |

Not touched: `JV-2026-0001` (1,000 between التضامن and حضرموت, cannot tell if real), the hash-chained `material_domain_events` log, real backup records and the restore-test log.

## Important: the raw download is inconsistent
`production-backup-2026-11-21/rawasi_aden.db` + `-wal` fails `PRAGMA integrity_check` ("malformed"); `rawasi_aden.production-ready.db` passes. The likely reason is that the file and its WAL were downloaded at different moments from a running server. **Before anything is uploaded, check the live server** (Settings → backup health / integrity, or a fresh consistent backup) to rule out a damaged live database.

## How to run (always on a copy, never on the live file)
```
node ops/prod-cleanup-2026-11-23/cleanup_test_data.js --source <copy of the production db> --out <new folder> [options]
```
- default: only the groups that are certainly test data
- `--include-orphan-demo`: also the two REC-MNR receipts
- `--include-orphan-entries`: also `JE-00009` and the inventory entries (all or none; the script re-checks at run time that no source document exists)
- `--rc-2026-0001=keep|unlink|delete`: `keep` (default) leaves it; `unlink` keeps the bank entry as a real transfer and detaches it from the client; `delete` removes it as a trial

The source is opened read-only. The output folder gets `before.db`, `cleaned.db`, `report.md` and `report.json`. Everything runs in one transaction. If any record outside the plan points at something planned for deletion, the script stops and changes nothing.

## Decisions recorded
| Item | Decision | Date |
|---|---|---|
| `RC-2026-0001` | **a trial: delete** (`--rc-2026-0001=delete`) | 2026-11-23 |
| `REC-MNR-001/002` | **delete** (`--include-orphan-demo`) | 2026-11-23 |
| Entries without a source document | **delete** (`--include-orphan-entries`) | 2026-11-23 |
| `JV-2026-0001` (1,000 between banks) | **a trial: delete** (`--include-manual-trial`, only if it still matches exactly) | 2026-11-23 |

Approved command (its trial run is summarised below):
```
node ops/prod-cleanup-2026-11-23/cleanup_test_data.js --source <copy of a fresh production backup> --out <new folder> --include-orphan-demo --include-orphan-entries --include-manual-trial --rc-2026-0001=delete
```
Expected result on the 2026-11-21 data:
- all 20 entries, 7 receipts and 7 test periods removed: the ledger starts empty;
- client 1 returns to its opening balance of 100,000, and the 5 real accounting periods stay;
- the numbers already used stay reserved in `document_sequences`, so the next numbers are `JV-2026-0009`, `JV-RC-2026-0002`, `JE-00010` and `RC-2026-0002` (no reuse of a deleted number);
- integrity ok, and it boots on the PR #13 code with 0 warnings.

If the fresh backup holds new real activity, the counts will differ. Read the new `report.md` before uploading.

## Trial runs on a copy of `production-ready.db`
The trial reports (`trial_report_*.md`, and the `report.md` / `report.json` each run writes) contain production
data: client names, balances and local paths. They stay on the machine that ran them and are git-ignored.
- `trial_report_decided.md`: default scope plus `RC-2026-0001=delete`. Client 1 goes from −900,000 to 100,000, both banks and every `TEST_` account return to 0, integrity is ok, and it boots on the PR #13 code with 0 warnings.
- `trial_report_default.md`: default scope. Integrity ok, no broken references, boots on the PR #13 code with 0 warnings.
- `trial_report_full.md`: every option, with `RC-2026-0001=delete`. Every affected account returns to 0, and client 1 returns to its opening balance of 100,000. It also boots with 0 warnings.

## Uploading (your step, never done by the assistant)
1. Take a fresh, consistent backup of the live server and keep it.
2. Run the script on a copy of that backup with the options you chose, then read `report.md`.
3. Stop writes, upload `cleaned.db` through your own procedure (`upload_to_production.ps1` in the backup folder), then deploy the PR #13 code so migrations 0001–0006 run.
