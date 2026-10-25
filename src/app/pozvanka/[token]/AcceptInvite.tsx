'use client';

import { useState, useTransition } from 'react';
import { acceptInviteAction } from './actions';

export function AcceptInvite({ token }: { token: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await acceptInviteAction(token);
            if (!res.ok) setError(res.error);
          })
        }
      >
        {pending ? 'Prijímam…' : 'Prijať pozvánku'}
      </button>
      {error && <p className="error">{error}</p>}
    </>
  );
}
