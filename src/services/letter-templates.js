export const letterTemplates = [
  {
    id: 'goods-collection-authorization',
    title: 'Goods Collection Authorization',
    body: `<p>This letter is to formally confirm that <strong>New Interior Decorators (PTY) LTD</strong> hereby authorizes <strong>{{FULL_NAME}}</strong>, holding Passport/ID Number <strong>{{ID_NUMBER}}</strong>, to collect and deliver goods from South Africa on behalf of the company.</p>
<p>The relevant Invoice Number is <strong>{{INVOICE_NUMBER}}</strong>.</p>
<p>We kindly request that your office extend all necessary assistance and cooperation to the above-mentioned individual while carrying out this assignment.</p>
<p>Thank you for your attention and cooperation.</p>`,
  },
  {
    id: 'authority-to-act',
    title: 'Authority to Act on Behalf of the Company',
    body: `<p>To whom it may concern,</p>
<p>This letter serves as formal confirmation that <strong>{{EMPLOYEE_FULL_NAME}}</strong>, holder of ID/Passport Number <strong>{{ID_OR_PASSPORT_NUMBER}}</strong>, and currently employed as <strong>{{POSITION}}</strong>, is hereby authorized to act on behalf of <strong>{{COMPANY_NAME}}</strong>.</p>
<p>The employee is specifically authorized to perform the following task: <strong>{{TASK_TO_BE_PERFORMED}}</strong>.</p>
<p>This authorization is effective on <strong>{{DATE}}</strong> and remains valid for the duration required to complete the above assignment, unless revoked in writing by the company.</p>
<p>Please extend all necessary assistance and cooperation to the above-mentioned employee.</p>
<p>Authorized By:</p>
<p><strong>{{AUTHORIZED_BY}}</strong><br/><strong>{{AUTHORIZED_TITLE}}</strong></p>`,
  },
  {
    id: 'proof-of-employment',
    title: 'Proof of Employment',
    body: `<p>To whom it may concern,</p>
<p>This letter confirms that <strong>{{EMPLOYEE_FULL_NAME}}</strong>, ID Number <strong>{{ID_NUMBER}}</strong>, is employed by <strong>{{COMPANY_NAME}}</strong> as <strong>{{POSITION}}</strong>.</p>
<p>The employee's current salary is <strong>{{SALARY}}</strong> per month.</p>
<p>Employment status: <strong>{{EMPLOYMENT_STATUS_PERMANENT_OR_PART_TIME}}</strong>.</p>
<p>Employment start date: <strong>{{EMPLOYMENT_START_DATE}}</strong>.</p>
<p>This letter has been issued at the request of the employee for submission to a bank and is true to the best of our knowledge.</p>
<p>Date issued: <strong>{{DATE_ISSUED}}</strong>.</p>
<p>Sincerely,</p>
<p><strong>{{AUTHORIZED_BY}}</strong><br/><strong>{{AUTHORIZED_TITLE}}</strong></p>`,
  },
  {
    id: 'request-for-payment',
    title: 'Request for Payment',
    body: `<p>Dear <strong>{{CUSTOMER_NAME}}</strong>,</p>
<p>We hope you are well. This letter serves as a friendly reminder regarding the outstanding payment for Invoice Number <strong>{{INVOICE_NUMBER}}</strong>, dated <strong>{{INVOICE_DATE}}</strong>.</p>
<p>The amount currently due is <strong>{{AMOUNT_DUE}}</strong>, and the payment due date was <strong>{{DUE_DATE}}</strong>.</p>
<p>We kindly request that payment be made at your earliest convenience to avoid any interruption of services.</p>
<p>If payment has already been made, please share proof of payment so we can update our records.</p>
<p>Payment details:<br/><strong>{{PAYMENT_DETAILS}}</strong></p>
<p>Thank you for your cooperation.</p>
<p>Sincerely,</p>
<p><strong>{{AUTHORIZED_BY}}</strong><br/><strong>{{AUTHORIZED_TITLE}}</strong></p>`,
  },
  {
    id: 'quotation-cover-letter',
    title: 'Quotation Cover Letter',
    body: `<p>Dear <strong>{{CLIENT_NAME}}</strong>,</p>
<p>Thank you for the opportunity to provide our quotation for <strong>{{PROJECT_OR_ITEM}}</strong>.</p>
<p>Please find attached Quotation Number <strong>{{QUOTATION_NUMBER}}</strong>, dated <strong>{{QUOTATION_DATE}}</strong>, for your review.</p>
<p>Total quoted amount: <strong>{{QUOTATION_TOTAL}}</strong>.</p>
<p>This quotation is valid until <strong>{{VALID_UNTIL_DATE}}</strong>.</p>
<p>Should you require any clarification or adjustments, please contact us and we will gladly assist.</p>
<p>We look forward to your confirmation.</p>
<p>Kind regards,</p>
<p><strong>{{AUTHORIZED_BY}}</strong><br/><strong>{{AUTHORIZED_TITLE}}</strong></p>`,
  },
];

export function getLetterTemplates() {
  return letterTemplates;
}

export function getLetterTemplateById(id) {
  return letterTemplates.find((template) => template.id === id);
}
