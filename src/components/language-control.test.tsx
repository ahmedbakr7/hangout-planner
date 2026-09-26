import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import React, { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import { LanguageControl } from "@/components/language-control";

function renderControl(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function SurroundingForm(): ReactElement {
  const [notes, setNotes] = useState("unsaved draft");
  return (
    <form>
      <label htmlFor="notes">Notes</label>
      <input
        id="notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <LanguageControl />
    </form>
  );
}

afterEach(() => {
  cleanup();
  document.cookie = "hp_locale=;path=/;max-age=0";
  document.documentElement.lang = "en";
  document.documentElement.dir = "ltr";
});

describe("LanguageControl", () => {
  it("updates hp_locale and keeps unsaved input in the surrounding form", () => {
    renderControl(<SurroundingForm />);

    const notes = screen.getByLabelText("Notes") as HTMLInputElement;
    fireEvent.change(notes, { target: { value: "still here" } });

    const language = screen.getByRole("combobox", { name: "Language" });
    expect(language.className.split(/\s+/)).toContain("border-input");
    expect(language.className.split(/\s+/)).toContain("bg-background");
    expect(language.getAttribute("style")).toBeNull();

    fireEvent.change(language, {
      target: { value: "ar" },
    });

    expect(document.cookie).toMatch(/(?:^|; )hp_locale=ar(?:;|$)/);
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect((screen.getByLabelText("Notes") as HTMLInputElement).value).toBe(
      "still here",
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    expect(document.cookie).toMatch(/(?:^|; )hp_locale=en(?:;|$)/);
    expect(document.documentElement.dir).toBe("ltr");
    expect((screen.getByLabelText("Notes") as HTMLInputElement).value).toBe(
      "still here",
    );
  });
});
