import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import {
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("SettingsSelectorComponent", () => {
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	describe("theme override", () => {
		function focusThemeSetting(currentTheme: string, themeOverride: string) {
			const onThemePreview = vi.fn();
			const selector = new SettingsSelectorComponent(
				{
					currentTheme,
					themeOverride,
					terminalTheme: "dark",
					availableThemes: ["dark", "light", "solarized", "dayowl", "nightowl"],
					fullscreenScrollbar: "auto",
					warnings: {},
					availableThinkingLevels: [],
				} as unknown as SettingsConfig,
				{ onThemePreview } as unknown as SettingsCallbacks,
			);
			const settingsList = selector.getSettingsList();

			for (const character of "Theme") settingsList.handleInput(character);
			return { settingsList, onThemePreview };
		}

		function openThemeSettings(currentTheme: string, themeOverride: string) {
			const result = focusThemeSetting(currentTheme, themeOverride);
			result.settingsList.handleInput("\r");
			return result;
		}

		it("describes the active theme override", () => {
			const { settingsList } = focusThemeSetting("light/dark", "dayowl/nightowl");

			expect(stripAnsi(settingsList.render(120).join("\n"))).toContain(
				"Color theme for the interface. Active override: dayowl/nightowl",
			);
		});

		it("marks the light side of a paired override", () => {
			const { settingsList } = openThemeSettings("light/dark", "dayowl/nightowl");

			settingsList.handleInput("\r");

			expect(stripAnsi(settingsList.render(120).join("\n"))).toMatch(/dayowl\s+Override from --use-theme/);
		});

		it("marks the dark side of a paired override", () => {
			const { settingsList } = openThemeSettings("light/dark", "dayowl/nightowl");

			settingsList.handleInput("\x1b[B");
			settingsList.handleInput("\r");

			expect(stripAnsi(settingsList.render(120).join("\n"))).toMatch(/nightowl\s+Override from --use-theme/);
		});

		it("restores a paired override after canceling a nested preview", () => {
			const { settingsList, onThemePreview } = openThemeSettings("light/dark", "dayowl/nightowl");

			settingsList.handleInput("\r");
			settingsList.handleInput("\x1b[B");
			settingsList.handleInput("\x1b");
			settingsList.handleInput("\x1b");

			expect(onThemePreview.mock.calls.flat()).toEqual(["solarized", "nightowl", "dayowl/nightowl"]);
		});

		it("marks a single-theme override", () => {
			const { settingsList } = openThemeSettings("light", "dayowl");

			expect(stripAnsi(settingsList.render(120).join("\n"))).toMatch(/dayowl\s+Override from --use-theme/);
		});

		it("restores a single-theme override after canceling a direct preview", () => {
			const { settingsList, onThemePreview } = openThemeSettings("light", "dayowl");

			settingsList.handleInput("\x1b[B");
			settingsList.handleInput("\x1b");

			expect(onThemePreview.mock.calls.flat()).toEqual(["solarized", "dayowl"]);
		});
	});

	it("cycles through fullscreen scrollbar modes", () => {
		const onChange = vi.fn();
		const selector = new SettingsSelectorComponent(
			{
				fullscreenScrollbar: "auto",
				warnings: {},
				availableThinkingLevels: [],
				availableThemes: [],
			} as unknown as SettingsConfig,
			{ onFullscreenScrollbarChange: onChange } as unknown as SettingsCallbacks,
		);
		const settingsList = selector.getSettingsList();

		for (const character of "Fullscreen scrollbar") settingsList.handleInput(character);
		settingsList.handleInput("\r");
		settingsList.handleInput("\r");
		settingsList.handleInput("\r");

		expect(onChange.mock.calls.flat()).toEqual(["always", "hidden", "auto"]);
	});
});
