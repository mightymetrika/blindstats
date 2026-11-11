# Paired blindstats exercise (recommended)

**Two people, two invited accounts:** one **blinding custodian** and one **blinded analyst**. Use **only synthetic data**—never real, confidential, client, or regulated data. blindstats is an early research preview.

**Files from GitHub:** [Synthetic CSV](https://github.com/mightymetrika/blindstats/blob/1c426cd/docs/researcher-preview/synthetic_study.csv) · Analysis helper: [Windows](https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-windows.ps1) / [macOS](https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-macos.command) / [Linux](https://github.com/mightymetrika/blindstats/blob/1c426cd/scripts/researcher-preview/researcher-preview-linux.sh). On each file page choose **Download raw file**. Save the CSV or helper you need in **Downloads**. Nothing is attached to the invitation email.

Sign in at [blindstats.com](https://blindstats.com). Arrange a way to share the *synthetic* blinded file and, later, the unblinding secret outside blindstats; the app does not yet transfer files.

## Exercise

1. **Custodian — Set up:** Create a Study (*Synthetic preview*) and a Blinding workflow. Under **Blinding plan**, choose **Independent authorization** and require an **Analysis Lock**; **Save draft**. Under **Analysis roles**, assign the analyst using their existing blindstats account email. Return to the plan and activate it.
2. **Custodian — Blind:** Open **Blinded package**. Select `synthetic_study.csv`, blind the `group` column, download the blinded CSV, public receipt, and unblinding secret, and register the package. **Keep the secret; share only the synthetic blinded CSV with the analyst.**
3. **Analyst — Analyze the blinded CSV** using the **analysis helper** command for your OS below. Use the blinded CSV received from the custodian, saved as `synthetic_study_blinded.csv` in **Downloads**. It creates `analysis_artifact.txt` locally.
4. **Analyst — Lock and request:** In the shared Study, register an **Analysis Lock** using `analysis_artifact.txt` (save the lock receipt), then request unblinding against that lock.
5. **Custodian — Authorize:** Authorize the analyst's request in blindstats, then give the analyst the saved unblinding secret through your agreed external channel.
6. **Analyst — Complete:** Supply the secret locally, complete unblinding, download the final receipt, and inspect **Audit history**. **Both people** submit feedback: [Private feedback form](https://blindstats.com/feedback).

## Analysis helper commands

**Windows — PowerShell**
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$HOME\Downloads\researcher-preview-windows.ps1" -Action Analyze -InputCsv "$HOME\Downloads\synthetic_study_blinded.csv"
```
**macOS — Terminal**
```sh
sh "$HOME/Downloads/researcher-preview-macos.command" analyze "$HOME/Downloads/synthetic_study_blinded.csv"
```
**Linux — Terminal**
```sh
sh "$HOME/Downloads/researcher-preview-linux.sh" analyze "$HOME/Downloads/synthetic_study_blinded.csv"
```
The helper creates `analysis_artifact.txt` in your home folder under `blindstats-preview-files`. If your browser saved the blinded CSV elsewhere or renamed it, adjust its path in the command.

**Do not send your passwords, unblinding secret, or research files to the feedback organizer.**
