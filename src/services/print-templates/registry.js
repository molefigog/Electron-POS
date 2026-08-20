import { renderClassic } from './classic';
import { renderModern } from './modern';
import { renderMinimal } from './minimal';

/**
 * Add a new layout by adding one entry here - nothing else in the app
 * (Transactions page, Settings page, PDF export) needs to change.
 */
export const PRINT_TEMPLATES = {
  classic: { label: 'Classic', render: renderClassic },
  modern: { label: 'Modern', render: renderModern },
  minimal: { label: 'Minimal', render: renderMinimal },
};

export function renderTemplate(key, tx, company) {
  const template = PRINT_TEMPLATES[key] || PRINT_TEMPLATES.classic;
  return template.render(tx, company);
}
