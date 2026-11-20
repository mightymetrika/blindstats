"use client";

import { useRef, type FormEvent } from "react";
import { useFormStatus } from "react-dom";

type CreateStudyFormProps = {
  action: (formData: FormData) => void | Promise<void>;
};

function CreateStudySubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:cursor-wait disabled:opacity-60"
      disabled={pending}
      type="submit"
    >
      {pending ? "Creating Study..." : "Create Study"}
    </button>
  );
}

export function CreateStudyForm({ action }: CreateStudyFormProps) {
  const submitted = useRef(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // The ref flips immediately, before React's pending UI is rendered.
    // It prevents double-clicks/Enter from submitting the same form twice.
    if (submitted.current) {
      event.preventDefault();
      return;
    }
    submitted.current = true;
  }

  return (
    <form action={action} className="mt-5 space-y-4" onSubmit={handleSubmit}>
      <div>
        <label className="text-sm font-medium" htmlFor="name">
          Study name
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
          id="name"
          name="name"
          placeholder="For example: Texas Science ANCOVA"
          type="text"
          maxLength={200}
          required
        />
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor="description">
          Description{" "}
          <span className="font-normal text-black/45 dark:text-white/45">
            (optional)
          </span>
        </label>
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-black/15 bg-transparent px-3 py-2 outline-none focus:border-black/40 dark:border-white/20 dark:focus:border-white/50"
          id="description"
          name="description"
          placeholder="Short description of the study."
          maxLength={2000}
        />
      </div>
      <CreateStudySubmitButton />
    </form>
  );
}
