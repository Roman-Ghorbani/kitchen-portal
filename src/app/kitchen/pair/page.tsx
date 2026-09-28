import { PairForm } from './pair-form.tsx';

export const metadata = { title: 'Pair this tablet' };

/** Where a chef tablet is paired, once, with a code from the manager. */
export default function PairPage() {
  return (
    <div className="kq-shell kq-locked" data-theme="light">
      <div className="kq-locked-card">
        <h1>Pair this tablet</h1>
        <p>
          Enter the pairing code from the kitchen manager. This tablet will then
          stay signed in to the kitchen screen.
        </p>
        <PairForm />
      </div>
    </div>
  );
}
