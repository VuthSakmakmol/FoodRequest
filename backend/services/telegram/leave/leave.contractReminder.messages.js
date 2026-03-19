const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

function buildLeaveContractReminderMessage({
  employeeId,
  employeeName,
  department,
  endDate,
  daysLeft,
  contractNo,
}) {
  return [
    `📄 <b>Contract expiry reminder</b>`,
    ``,
    `Employee ID: <b>${esc(employeeId)}</b>`,
    `Name: <b>${esc(employeeName || '-')}</b>`,
    `Department: <b>${esc(department || '-')}</b>`,
    `Contract No: <b>${esc(contractNo)}</b>`,
    `End Date: <b>${esc(endDate)}</b>`,
    `Days Left: <b>${esc(daysLeft)}</b>`,
    ``,
    `Please consider whether to <b>renew contract</b> or <b>end contract</b>.`,
  ].join('\n')
}

module.exports = {
  buildLeaveContractReminderMessage,
}