import { invoke, isTauri } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { terminalHeight } from "./model";

type Tab = {
  number: number;
  id?: number;
  shell: string;
  term: Terminal;
  fit: FitAddon;
  screen: HTMLDivElement;
  exited: boolean;
  writing: boolean;
  input: Promise<unknown>;
};
type Output = {
  data: number[];
  exited: boolean;
  exitCode: number | null;
  dropped: boolean;
};
const HEIGHT_KEY = "borgd.terminal.height";

export class TerminalDock {
  readonly element = document.createElement("section");
  private tabs: Tab[] = [];
  private active?: Tab;
  private counter = 0;
  private creating = false;
  private polling = false;
  private opened = false;
  private height = 280;
  private frame = 0;
  private controls = document.createElement("div");
  private screens = document.createElement("div");
  private grip = document.createElement("div");

  constructor(
    private report: (message: string, bad?: boolean) => void,
    private changed: () => void,
  ) {
    try {
      this.height = terminalHeight(localStorage.getItem(HEIGHT_KEY));
    } catch {
      /* Storage can be unavailable. */
    }
    this.element.className = "terminal-dock";
    this.element.setAttribute("aria-label", "Integrated system terminal");
    this.element.hidden = true;
    this.grip.className = "terminal-resizer";
    this.grip.tabIndex = 0;
    this.grip.setAttribute("role", "separator");
    this.grip.setAttribute("aria-label", "Resize terminal panel");
    this.grip.setAttribute("aria-orientation", "horizontal");
    this.grip.setAttribute("aria-valuemin", "120");
    this.controls.className = "terminal-controls";
    this.screens.className = "terminal-screens";
    const note = document.createElement("div");
    note.className = "terminal-note";
    note.textContent =
      "Real system shell · Commands run as your user. Closing a tab or borgd stops its shell.";
    this.element.append(this.grip, this.controls, this.screens, note);
    this.grip.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const original = this.height,
        y = event.clientY;
      this.grip.setPointerCapture(event.pointerId);
      const move = (move: PointerEvent) =>
        this.setHeight(original + y - move.clientY);
      const stop = () => {
        this.grip.removeEventListener("pointermove", move);
        this.grip.removeEventListener("pointerup", stop);
        this.grip.removeEventListener("pointercancel", stop);
        this.persistHeight();
      };
      this.grip.addEventListener("pointermove", move);
      this.grip.addEventListener("pointerup", stop);
      this.grip.addEventListener("pointercancel", stop);
    });
    this.grip.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      this.setHeight(
        event.key === "Home"
          ? 120
          : event.key === "End"
            ? this.maxHeight()
            : this.height + (event.key === "ArrowUp" ? 16 : -16),
      );
      this.persistHeight();
    });
    new ResizeObserver(() => {
      this.applyHeight();
      this.scheduleFit();
    }).observe(this.element);
    window.addEventListener("resize", () => {
      this.applyHeight();
      this.scheduleFit();
    });
    setInterval(() => {
      void this.poll();
    }, 100);
  }
  get visible() {
    return this.opened;
  }
  attach(main: HTMLElement) {
    main.insertBefore(this.element, main.querySelector(":scope > footer"));
    this.applyHeight();
    this.scheduleFit();
  }
  async toggle() {
    if (!isTauri()) {
      this.report("The system terminal is available in the desktop app.", true);
      return;
    }
    this.opened = !this.opened;
    this.element.hidden = !this.opened;
    this.changed();
    if (this.opened && !this.tabs.length) await this.add();
    this.applyHeight();
    this.scheduleFit();
    if (this.opened) this.active?.term.focus();
  }
  private maxHeight() {
    return Math.max(
      120,
      (this.element.parentElement?.clientHeight || innerHeight) - 190,
    );
  }
  private setHeight(height: number) {
    this.height = Math.max(120, Math.min(this.maxHeight(), height));
    this.applyHeight();
    this.scheduleFit();
  }
  private applyHeight() {
    this.element.style.height = `${Math.min(this.height, this.maxHeight())}px`;
    this.grip.setAttribute(
      "aria-valuenow",
      String(Math.round(Math.min(this.height, this.maxHeight()))),
    );
    this.grip.setAttribute(
      "aria-valuemax",
      String(Math.round(this.maxHeight())),
    );
  }
  private persistHeight() {
    try {
      localStorage.setItem(HEIGHT_KEY, String(Math.round(this.height)));
    } catch {
      /* Keep the in-memory size. */
    }
  }
  private scheduleFit() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (!this.opened || !this.active || !this.element.isConnected) return;
      this.active.fit.fit();
    });
  }
  private makeButton(label: string, title: string, clicked: () => void) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", clicked);
    return button;
  }
  private drawTabs() {
    this.controls.replaceChildren();
    const list = document.createElement("div");
    list.className = "terminal-tabs";
    list.setAttribute("role", "tablist");
    list.setAttribute("aria-label", "Terminal sessions");
    this.tabs.forEach((tab) => {
      const item = document.createElement("div");
      item.className = `terminal-tab ${this.active === tab ? "selected" : ""}`;
      const select = this.makeButton(
        `Terminal ${tab.number}${tab.exited ? " (exited)" : ""}`,
        tab.shell,
        () => this.select(tab),
      );
      select.setAttribute("role", "tab");
      select.setAttribute("aria-label", `Terminal ${tab.number}`);
      select.id = `terminal-tab-${tab.number}`;
      select.setAttribute("aria-controls", tab.screen.id);
      select.setAttribute("aria-selected", String(this.active === tab));
      select.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const index = this.tabs.indexOf(tab);
        this.select(
          this.tabs[
            (index + (event.key === "ArrowRight" ? 1 : this.tabs.length - 1)) %
              this.tabs.length
          ],
        );
        this.controls
          .querySelector<HTMLElement>(`#terminal-tab-${this.active!.number}`)
          ?.focus();
      });
      const close = this.makeButton(
        "×",
        `Close Terminal ${tab.number} and stop its shell`,
        () => {
          void this.close(tab);
        },
      );
      close.disabled = tab.id === undefined;
      item.append(select, close);
      list.append(item);
    });
    const actions = document.createElement("div");
    actions.className = "terminal-panel-actions";
    const add = this.makeButton("+", "New terminal tab", () => {
      void this.add();
    });
    add.disabled = this.creating || this.tabs.length >= 12;
    const clear = this.makeButton(
      "Clear",
      "Clear active terminal display",
      () => this.active?.term.clear(),
    );
    const hide = this.makeButton(
      "Hide",
      "Hide terminal panel (keep sessions running)",
      () => {
        void this.toggle();
      },
    );
    actions.append(add, clear, hide);
    this.controls.append(list, actions);
  }
  private select(tab: Tab) {
    this.active = tab;
    this.tabs.forEach((item) => (item.screen.hidden = item !== tab));
    this.drawTabs();
    this.scheduleFit();
    tab.term.focus();
  }
  private async add() {
    if (this.creating) return;
    this.creating = true;
    const screen = document.createElement("div");
    screen.className = "terminal-screen";
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      scrollback: 5000,
      theme: {
        background: "#14171c",
        foreground: "#d3dbe8",
        cursor: "#a9c3ff",
        selectionBackground: "#3b5078",
      },
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const tab: Tab = {
      number: ++this.counter,
      shell: "Starting system shell",
      term,
      fit,
      screen,
      exited: false,
      writing: false,
      input: Promise.resolve(),
    };
    screen.id = `terminal-screen-${tab.number}`;
    screen.setAttribute("role", "tabpanel");
    screen.setAttribute("aria-labelledby", `terminal-tab-${tab.number}`);
    this.tabs.push(tab);
    this.screens.append(screen);
    this.select(tab);
    term.open(screen);
    fit.fit();
    this.drawTabs();
    try {
      const started = await invoke<{ id: number; shell: string }>(
        "terminal_create",
        {
          cols: Math.max(2, Math.min(500, term.cols)),
          rows: Math.max(1, Math.min(250, term.rows)),
        },
      );
      tab.id = started.id;
      tab.shell = started.shell;
      term.onData((data) => {
        if (tab.exited) return;
        // Preserve keystroke/paste ordering across asynchronous IPC calls.
        tab.input = tab.input
          .then(async () => {
            for (const chunk of data.match(/[\s\S]{1,4096}/gu) ?? [])
              await invoke("terminal_write", { id: tab.id, data: chunk });
          })
          .catch((error) => this.report(String(error), true));
      });
      term.onResize(({ cols, rows }) => {
        if (tab.id && !tab.exited)
          void invoke("terminal_resize", {
            id: tab.id,
            cols: Math.min(500, cols),
            rows: Math.min(250, rows),
          }).catch((error) => this.report(String(error), true));
      });
      this.scheduleFit();
      term.focus();
    } catch (error) {
      term.writeln(`\r\nCould not start system shell: ${String(error)}`);
      tab.exited = true;
      this.report(String(error), true);
      // Failed startup has no native session, but its tab must remain closable.
      tab.id = 0;
    } finally {
      this.creating = false;
      this.drawTabs();
    }
  }
  private async close(tab: Tab) {
    try {
      if (tab.id) await invoke("terminal_close", { id: tab.id });
      this.tabs = this.tabs.filter((item) => item !== tab);
      tab.term.dispose();
      tab.screen.remove();
      if (this.active === tab) this.active = this.tabs.at(-1);
      if (this.active) this.select(this.active);
      else {
        this.drawTabs();
        this.opened = false;
        this.element.hidden = true;
        this.changed();
      }
    } catch (error) {
      this.report(String(error), true);
    }
  }
  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      await Promise.all(
        this.tabs
          .filter((tab) => tab.id && !tab.exited && !tab.writing)
          .map(async (tab) => {
            try {
              const output = await invoke<Output>("terminal_read", {
                id: tab.id,
              });
              if (!this.tabs.includes(tab)) return;
              if (output.dropped)
                tab.term.write(
                  "\r\n[Some output was discarded: terminal buffer exceeded 1 MiB.]\r\n",
                );
              if (output.data.length) {
                // Backpressure keeps fast commands from filling xterm's write queue.
                tab.writing = true;
                tab.term.write(new Uint8Array(output.data), () => {
                  tab.writing = false;
                });
              }
              if (output.exited) {
                tab.exited = true;
                tab.term.writeln(
                  `\r\n[Shell exited${output.exitCode === null ? "" : ` with code ${output.exitCode}`} ]`,
                );
                this.drawTabs();
              }
            } catch (error) {
              if (this.tabs.includes(tab)) {
                tab.exited = true;
                this.drawTabs();
                this.report(String(error), true);
              }
            }
          }),
      );
    } finally {
      this.polling = false;
    }
  }
}
