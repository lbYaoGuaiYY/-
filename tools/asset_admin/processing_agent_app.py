"""Minimal desktop shell for the outbound-only Qingshe background remover."""

from __future__ import annotations

import logging
import os
import queue
import sys
import tkinter as tk
from threading import Event, Thread

from tools.asset_admin.processing_agent import (
    DEFAULT_PROCESSING_URL,
    ProcessorConfiguration,
    default_processor_configuration_path,
    run_agent,
    wait_for_processor_configuration,
)

STATUS_PRESENTATIONS = {
    "connecting": ("正在连接", "#e7b657"),
    "ready": ("已连接", "#45c98a"),
    "processing": ("正在抠图", "#4d8dff"),
    "error": ("连接异常", "#ed6b72"),
}


def status_presentation(state: str) -> tuple[str, str]:
    return STATUS_PRESENTATIONS.get(state, STATUS_PRESENTATIONS["error"])


def button_text_color(platform_name: str) -> str:
    """Keep labels readable when macOS renders Tk buttons with a native light fill."""
    return "#111111" if platform_name == "darwin" else "#ffffff"


class ProcessingAgentApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.stop_event = Event()
        self.status_updates: queue.SimpleQueue[tuple[str, str]] = queue.SimpleQueue()
        self.window_actions: queue.SimpleQueue[str] = queue.SimpleQueue()
        self.status_text = tk.StringVar(value="正在连接")
        self.detail_text = tk.StringVar(value="正在启动并上报云端…")
        self.status_dot: tk.Canvas
        self._build_window()
        self.root.after(100, self._drain_status_updates)
        Thread(target=self._run_worker, daemon=True).start()

    def _build_window(self) -> None:
        self.root.title("轻抠")
        self.root.geometry("420x270")
        self.root.minsize(380, 250)
        self.root.configure(background="#161616")
        self.root.protocol("WM_DELETE_WINDOW", self.root.iconify)
        try:
            self.root.tk.call("tk", "appname", "轻抠")
        except tk.TclError:
            pass

        shell = tk.Frame(self.root, background="#161616", padx=20, pady=18)
        shell.pack(fill="both", expand=True)
        tk.Label(
            shell,
            text="轻抠",
            background="#161616",
            foreground="#f2f2f2",
            font=("", 17, "bold"),
        ).pack(anchor="w")
        tk.Label(
            shell,
            text="保持运行，自动处理云素材中的抠图任务",
            background="#161616",
            foreground="#b8b8b8",
            font=("", 12),
        ).pack(anchor="w", pady=(4, 16))

        status_row = tk.Frame(
            shell,
            background="#252525",
            highlightbackground="#3c3c3c",
            highlightthickness=1,
            padx=14,
            pady=12,
        )
        status_row.pack(fill="x")
        self.status_dot = tk.Canvas(
            status_row,
            width=12,
            height=12,
            background="#252525",
            highlightthickness=0,
        )
        self.status_dot.create_oval(2, 2, 10, 10, fill="#e7b657", outline="")
        self.status_dot.pack(side="left", padx=(0, 10))
        text = tk.Frame(status_row, background="#252525")
        text.pack(side="left", fill="x", expand=True)
        tk.Label(
            text,
            textvariable=self.status_text,
            background="#252525",
            foreground="#f2f2f2",
            font=("", 13, "bold"),
        ).pack(anchor="w")
        tk.Label(
            text,
            textvariable=self.detail_text,
            background="#252525",
            foreground="#a8a8a8",
            font=("", 11),
            wraplength=330,
            justify="left",
        ).pack(anchor="w", pady=(3, 0))

        actions = tk.Frame(shell, background="#161616")
        actions.pack(fill="x", pady=(16, 8))
        self._button(actions, "最小化", self.root.iconify, primary=True).pack(
            side="left", fill="x", expand=True
        )
        self._button(actions, "退出", self._quit).pack(side="left", padx=(8, 0))
        tk.Label(
            shell,
            text="关闭窗口会最小化；点击“退出”才会停止抠图服务。",
            background="#161616",
            foreground="#a8a8a8",
            font=("", 10),
        ).pack(anchor="w")

    def _button(
        self,
        parent: tk.Widget,
        label: str,
        command: object,
        *,
        primary: bool = False,
    ) -> tk.Button:
        return tk.Button(
            parent,
            text=label,
            command=command,
            padx=12,
            pady=8,
            borderwidth=1,
            relief="solid",
            background="#3b6dc7" if primary else "#303030",
            foreground=button_text_color(sys.platform),
            activebackground="#325dad" if primary else "#3a3a3a",
            activeforeground="#ffffff",
            highlightthickness=0,
        )

    def _emit_status(self, state: str, detail: str) -> None:
        self.status_updates.put((state, detail))

    def _drain_status_updates(self) -> None:
        while True:
            try:
                state, detail = self.status_updates.get_nowait()
            except queue.Empty:
                break
            label, color = status_presentation(state)
            self.status_text.set(label)
            self.detail_text.set(detail)
            self.status_dot.itemconfigure(1, fill=color)
        while True:
            try:
                action = self.window_actions.get_nowait()
            except queue.Empty:
                break
            if action == "raise":
                self.root.deiconify()
                self.root.lift()
                self.root.focus_force()
        if self.root.winfo_exists():
            self.root.after(100, self._drain_status_updates)

    def _request_window_raise(self) -> None:
        self.window_actions.put("raise")

    def _run_worker(self) -> None:
        try:
            configured_token = os.environ.get("QINGSHE_PROCESSING_NODE_TOKEN", "")
            configured_base_url = os.environ.get(
                "QINGSHE_PROCESSING_URL", DEFAULT_PROCESSING_URL
            ).rstrip("/")
            if configured_token != "" and configured_base_url == DEFAULT_PROCESSING_URL:
                configuration = ProcessorConfiguration(
                    base_url=configured_base_url, token=configured_token
                )
            else:
                configuration = wait_for_processor_configuration(
                    default_processor_configuration_path(),
                    base_url=configured_base_url if configured_base_url else DEFAULT_PROCESSING_URL,
                    status_callback=self._emit_status,
                    stop_event=self.stop_event,
                )
            run_agent(
                configuration.base_url,
                configuration.token,
                status_callback=self._emit_status,
                stop_event=self.stop_event,
            )
        except Exception:  # noqa: BLE001
            logging.exception("轻抠启动失败")
            self._emit_status("error", "启动失败，请重新打开程序后再试")

    def _quit(self) -> None:
        self.stop_event.set()
        self.root.destroy()


def main() -> None:
    log_path = default_processor_configuration_path().with_name("processor.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=log_path,
        level=os.environ.get("QINGSHE_AGENT_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    root = tk.Tk()
    ProcessingAgentApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
