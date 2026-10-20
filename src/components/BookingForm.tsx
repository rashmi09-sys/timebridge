import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEMO_GUEST } from '../lib/simulatedBookingService';
import { ArrowLeftIcon } from './Icons';

interface Errors {
  name?: string;
  email?: string;
  form?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function BookingForm(props: {
  submitting: boolean;
  onBack: () => void;
  onSubmit: (details: { name: string; email: string; notes: string }) => Promise<void>;
}) {
  const { submitting, onBack, onSubmit } = props;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const nameError = (v: string) => (v.trim() ? undefined : 'Enter your name.');
  const emailError = (v: string) =>
    !v.trim() ? 'Enter your email address.' : EMAIL.test(v.trim()) ? undefined : 'Enter an email address like name@example.com.';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = { name: nameError(name), email: emailError(email) };
    setErrors(next);
    if (next.name) return nameRef.current?.focus();
    if (next.email) return emailRef.current?.focus();
    try {
      await onSubmit({ name: name.trim(), email: email.trim(), notes: notes.trim() });
    } catch {
      setErrors({ form: 'Something went wrong while booking. Your time is still held here — try again.' });
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit} noValidate aria-labelledby="form-title">
      <h2 id="form-title" className="sr-only">
        Your details
      </h2>
      <div className="field">
        <label htmlFor="f-name">
          Your name <span aria-hidden="true">*</span>
        </label>
        <input
          ref={nameRef}
          id="f-name"
          name="name"
          autoComplete="name"
          placeholder={DEMO_GUEST.name}
          required
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'f-name-error' : undefined}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            // Never add an error while typing; only clear one once the value is fixed.
            if (errors.name && !nameError(e.target.value)) setErrors((x) => ({ ...x, name: undefined }));
          }}
        />
        {errors.name && (
          <p className="field-error" id="f-name-error">
            {errors.name}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="f-email">
          Email address <span aria-hidden="true">*</span>
        </label>
        <input
          ref={emailRef}
          id="f-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder={DEMO_GUEST.email}
          inputMode="email"
          required
          aria-required="true"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'f-email-error' : undefined}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email && !emailError(e.target.value)) setErrors((x) => ({ ...x, email: undefined }));
          }}
          // A typed address is checked when the guest leaves the field; an empty one waits for Confirm.
          onBlur={(e) => {
            if (e.target.value.trim()) setErrors((x) => ({ ...x, email: emailError(e.target.value) }));
          }}
        />
        {errors.email && (
          <p className="field-error" id="f-email-error">
            {errors.email}
          </p>
        )}
      </div>
      <div className="field">
        <label htmlFor="f-notes">Additional notes</label>
        <textarea
          id="f-notes"
          name="notes"
          rows={3}
          placeholder="Please share anything that will help prepare for our meeting."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {errors.form && (
        <p className="field-error" role="alert">
          {errors.form}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="button button-ghost" onClick={onBack} disabled={submitting}>
          <ArrowLeftIcon size={15} /> Back
        </button>
        <button type="submit" className="button button-primary" aria-disabled={submitting} data-busy={submitting || undefined}>
          {submitting ? (
            <>
              <span className="spinner" aria-hidden="true" /> Booking…
            </>
          ) : (
            'Confirm'
          )}
        </button>
      </div>
    </form>
  );
}
