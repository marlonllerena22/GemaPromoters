export function teamPasswordDeadline() {
  const value = process.env.FINANCE_TEAM_PASSWORD_CHANGE_AT;
  if (
    !value ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return null;
  return new Date(value).toISOString();
}
export function passwordChangePolicy(member, now = Date.now()) {
  const deadline = teamPasswordDeadline();
  const pending = Boolean(
    deadline &&
      member.role !== "owner" &&
      member.password_policy_completed !== deadline,
  );
  return {
    password_change_at: pending ? deadline : null,
    password_change_required: pending && now >= Date.parse(deadline),
  };
}
