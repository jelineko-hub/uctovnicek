import { CodeListsSettings } from '@/components/CodeListsSettings';
import { InboxSettings } from '@/components/InboxSettings';
import { MembersSettings } from '@/components/MembersSettings';
import { RulesSettings } from '@/components/RulesSettings';
import { loadCodeItems, loadRules } from '@/lib/accounting/service';
import { inboxAddress } from '@/lib/inbound/mail';
import { getInbox, listInboundEmails } from '@/lib/inbound/service';
import { memberRole } from '@/lib/export/service';
import { canInvite, canManageMembers, listInvites, listMembers } from '@/lib/members/service';
import { createClient } from '@/lib/supabase-server';

export default async function SettingsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = await memberRole(supabase, companyId);
  const [members, invites, items, rules, inbox, emails] = await Promise.all([
    listMembers(supabase, companyId),
    canInvite(role) ? listInvites(supabase, companyId) : Promise.resolve([]),
    loadCodeItems(supabase, companyId),
    loadRules(supabase, companyId),
    getInbox(supabase, companyId),
    listInboundEmails(supabase, companyId),
  ]);
  const accountingEditable = role === 'owner' || role === 'accountant';
  return (
    <>
      <h2>Ľudia</h2>
      <MembersSettings
        companyId={companyId}
        currentUserId={user?.id ?? ''}
        members={members}
        invites={invites}
        canInvite={canInvite(role)}
        canManage={canManageMembers(role)}
      />

      <h2 style={{ marginTop: 32 }}>Zberný e-mail</h2>
      <InboxSettings
        companyId={companyId}
        inbox={inbox}
        address={inbox ? inboxAddress(inbox.slug) : null}
        emails={emails}
        editable={accountingEditable}
      />

      <h2 style={{ marginTop: 32 }}>Účtovanie</h2>
      <CodeListsSettings companyId={companyId} items={items} editable={accountingEditable} />
      <RulesSettings companyId={companyId} rules={rules} items={items} editable={accountingEditable} />
    </>
  );
}
