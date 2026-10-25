'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  changeRoleAction,
  createInviteAction,
  deleteInviteAction,
  removeMemberAction,
} from '@/app/app/[companyId]/nastavenia/actions';
import { date } from '@/lib/format';
import { ROLE_HELP, ROLE_LABELS, ROLES, type Role } from '@/lib/members/roles';
import type { Member } from '@/lib/members/service';

interface Invite {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
}

const label = (r: string) => ROLE_LABELS[r as Role] ?? r;

export function MembersSettings({
  companyId,
  currentUserId,
  members,
  invites,
  canInvite,
  canManage,
}: {
  companyId: string;
  currentUserId: string;
  members: Member[];
  invites: Invite[];
  canInvite: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('accountant');
  const [newLink, setNewLink] = useState<string | null>(null);

  const link = (token: string) => `${window.location.origin}/pozvanka/${token}`;
  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(link(token));
      setMessage({ type: 'ok', text: 'Odkaz skopírovaný.' });
    } catch {
      setMessage({ type: 'error', text: 'Kopírovanie zlyhalo — označ odkaz a skopíruj ho ručne.' });
    }
  };

  function run(action: () => Promise<{ ok: boolean; error?: string; token?: string }>, okText?: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setMessage({ type: 'error', text: res.error ?? 'Chyba' });
      else {
        if (okText) setMessage({ type: 'ok', text: okText });
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Členovia</h3>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>E-mail</th><th>Rola</th><th>Od</th><th /></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <td>{m.email}{m.user_id === currentUserId && <span className="muted small"> (ty)</span>}</td>
                  <td>
                    {canManage ? (
                      <select
                        value={m.role}
                        disabled={pending}
                        onChange={(e) => run(() => changeRoleAction(companyId, m.user_id, e.target.value), 'Rola zmenená.')}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    ) : (
                      label(m.role)
                    )}
                  </td>
                  <td>{date(m.created_at)}</td>
                  <td>
                    {canManage && m.user_id !== currentUserId && (
                      <button
                        type="button"
                        className="link"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`Odobrať ${m.email} z firmy?`)) run(() => removeMemberAction(companyId, m.user_id), 'Člen odobratý.');
                        }}
                      >
                        Odobrať
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canInvite && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Pozvať do firmy</h3>
          <form
            className="filters"
            onSubmit={(e) => {
              e.preventDefault();
              setMessage(null);
              setNewLink(null);
              startTransition(async () => {
                const res = await createInviteAction(companyId, email, role);
                if (!res.ok) setMessage({ type: 'error', text: res.error });
                else {
                  setEmail('');
                  if (res.token) setNewLink(link(res.token));
                  router.refresh();
                }
              });
            }}
          >
            <input type="email" required placeholder="e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <button type="submit" disabled={pending}>Vytvoriť pozvánku</button>
          </form>
          <p className="small muted">{ROLE_LABELS[role]}: {ROLE_HELP[role]}. Odkaz platí 14 dní; pošli ho e-mailom alebo správou.</p>
          {newLink && (
            <p className="success">
              Pozvánka vytvorená. Odkaz: <input readOnly value={newLink} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
            </p>
          )}

          {invites.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Pozvaný</th><th>Rola</th><th>Platí do</th><th /></tr></thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td>{label(i.role)}</td>
                      <td>{new Date(i.expires_at) < new Date() ? <span className="error">vypršala</span> : date(i.expires_at)}</td>
                      <td className="row-actions" style={{ marginTop: 0 }}>
                        <button type="button" className="link" onClick={() => copy(i.token)}>Kopírovať odkaz</button>
                        <button type="button" className="link" disabled={pending} onClick={() => run(() => deleteInviteAction(companyId, i.id), 'Pozvánka zrušená.')}>
                          Zrušiť
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {message && <p className={message.type === 'error' ? 'error' : 'success'}>{message.text}</p>}
    </>
  );
}
