import { useState } from 'react';
import { ChevronDown, Download, FileSpreadsheet } from 'lucide-react';
import { Link } from 'react-router';
import {
  downloadTemplate,
  IMPORT_TEMPLATES,
  type ImportEntityType,
} from '@/services/dataImportService';

interface ImportTemplateMenuProps {
  entityTypes: ImportEntityType[];
}

const buttonClassName =
  'inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50';

/**
 * Makes the templates used by the import flow available in the feature where
 * the imported data belongs. The download still goes through dataImportService
 * so feature pages never need to know or duplicate a CSV schema.
 */
export function ImportTemplateMenu({ entityTypes }: ImportTemplateMenuProps) {
  const [open, setOpen] = useState(false);

  if (entityTypes.length === 0) return null;

  if (entityTypes.length === 1) {
    const entityType = entityTypes[0];
    return (
      <button
        type="button"
        onClick={() => downloadTemplate(entityType)}
        className={buttonClassName}
        title={`Download ${IMPORT_TEMPLATES[entityType].label} CSV template`}
      >
        <Download className="h-4 w-4 text-brand-500" />
        Download template
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className={buttonClassName}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Download className="h-4 w-4 text-brand-500" />
        Templates
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 z-30 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-2 shadow-lg"
          role="menu"
        >
          <p className="px-3 py-2 text-xs text-gray-500">
            Download a ready-to-fill CSV template for this feature.
          </p>
          {entityTypes.map(entityType => {
            const template = IMPORT_TEMPLATES[entityType];
            return (
              <button
                key={entityType}
                type="button"
                role="menuitem"
                onClick={() => {
                  downloadTemplate(entityType);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-brand-500" />
                <span className="min-w-0 flex-1 truncate">{template.label}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">CSV</span>
              </button>
            );
          })}
          <div className="mt-1 border-t border-gray-100 pt-1">
            <Link
              to={`/import?entity=${entityTypes[0]}`}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-xs font-medium text-brand-700 hover:bg-brand-50"
            >
              Open import workspace
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
