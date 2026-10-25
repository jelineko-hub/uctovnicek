import { MembersSettings } from '@/components/MembersSettings';
import { memberRole } from '@/lib/export/service';
import { canInvite, canManageMembers, listInvites, listMembers } from '@/lib/members/service';
import { createClient } from '@/lib/supabase-server';

export default async function SettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = await memberRole(supabase, companyId);
  const [members, invites] = await Promise.all([
    listMembers(supabase, companyId),
    canInvite(role) ? listInvites(supabase, companyId) : Promise.resolve([]),
  ]);
  return (
    <>
      <h2>Nastavenia firmy — ľudia</h2>
      <MembersSettings
        companyId={companyId}
        currentUserId={user?.id ?? ''}
        members={members}
        invites={invites}
        canInvite={canInvite(role)}
        canManage={canManageMembers(role)}
      />
      <p className="small muted">Číselné rady a Typ DPH pre MRP sú v záložke Export.</p>
    </>
  );
}
