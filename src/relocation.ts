import { invoke } from "@tauri-apps/api/core";
import { escape as e, type Relocation, type Result } from "./model";

function confirmRelocation(challenge: Relocation): Promise<boolean> {
  return new Promise((resolve) => {
    // Keep an existing operation form intact underneath this separate modal.
    const dialog = document.createElement("dialog");
    dialog.className = "modal relocation-dialog";
    dialog.innerHTML = `<form><div class="modal-heading"><div><h2>Confirm repository relocation</h2><p>Borg stopped because this repository has moved.</p></div><button type="button" class="icon-button" data-close aria-label="Close relocation dialog">&times;</button></div><div class="modal-body"><p>Only continue if you recognize both locations and intended to move or remount this repository.</p><p>Previous location<code>${e(challenge.paths.oldPath)}</code></p><p>Current location<code>${e(challenge.paths.newPath)}</code></p><p>This approval retries <strong>${e(challenge.action)}</strong> for this connection once. It does not disable other Borg safety checks or repair the drive. Confirmation expires after five minutes.</p></div><div class="modal-footer"><button type="button" class="button" data-close>Cancel</button><button type="submit" class="button primary">Confirm and retry ${e(challenge.action)}</button></div></form>`;
    dialog
      .querySelectorAll("[data-close]")
      .forEach((button) =>
        button.addEventListener("click", () => dialog.close()),
      );
    dialog.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      resolve(true);
      dialog.close();
    });
    dialog.addEventListener(
      "close",
      () => {
        dialog.remove();
        resolve(false);
      },
      { once: true },
    );
    document.querySelector("#modal-root")!.append(dialog);
    dialog.showModal();
    // Default to Cancel, never to the safety override.
    dialog
      .querySelector<HTMLButtonElement>(".modal-footer [data-close]")!
      .focus();
  });
}

export async function runWithRelocation(
  request: { action: string; repositoryId: string; [key: string]: unknown },
  waiting: () => Promise<Relocation | null | undefined>,
  running: () => void,
): Promise<Result> {
  const offered = new Set<string>();
  let command = "run_operation";
  let args: Record<string, unknown> = { request };
  for (;;) {
    try {
      return await invoke<Result>(command, args);
    } catch (error) {
      const challenge = await waiting();
      if (
        !challenge ||
        challenge.repositoryId !== request.repositoryId ||
        challenge.action !== request.action ||
        offered.has(challenge.token)
      )
        throw error;
      offered.add(challenge.token);
      if (!(await confirmRelocation(challenge))) {
        await invoke("dismiss_relocation", { token: challenge.token });
        throw new Error(
          "Repository relocation was not confirmed. No retry was performed.",
        );
      }
      command = "confirm_relocation";
      args = { token: challenge.token };
      running();
    }
  }
}
