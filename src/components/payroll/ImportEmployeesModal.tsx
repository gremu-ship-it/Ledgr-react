import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Upload, Download, AlertCircle, CheckCircle, AlertTriangle, X,
  Building2, Users, FileSpreadsheet, Loader2
} from 'lucide-react';
import { repos } from '@/lib/repositories';
import {
  parseCSVFile,
  validateRows,
  importEmployees,
  downloadTemplate,
  type ImportPreview,
  type ImportResult,
} from '@/services/dataImportService';

interface ImportEmployeesModalProps {
  businessId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportEmployeesModal({ businessId, onClose, onSuccess }: ImportEmployeesModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', businessId],
    queryFn: () => repos.branch.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', businessId],
    queryFn: () => repos.department.findActive(businessId),
    enabled: Boolean(businessId),
  });

  const branchCodeSet = new Set(
    branches.map((b) => (b.code || '').trim().toLowerCase()).filter(Boolean),
  );
  const branchNameSet = new Set(
    branches.map((b) => b.name.trim().toLowerCase()).filter(Boolean),
  );
  const deptCostCentreSet = new Set(
    departments.map((d) => (d.cost_centre || '').trim().toLowerCase()).filter(Boolean),
  );
  const deptCodeSet = new Set(
    departments.map((d) => (d.code || '').trim().toLowerCase()).filter(Boolean),
  );

  async function handleFileChange(selectedFile: File) {
    if (!selectedFile.name.endsWith('.csv')) {
      setError('Please upload a valid .csv file.');
      return;
    }
    setError(null);
    setFile(selectedFile);
    setIsParsing(true);
    try {
      const parsed = await parseCSVFile(selectedFile);
      const validated = validateRows(parsed, 'employees');
      setPreview(validated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV file');
    } finally {
      setIsParsing(false);
    }
  }

  async function handleImport() {
    if (!preview || preview.validRows === 0) return;
    setIsImporting(true);
    setError(null);
    try {
      const result = await importEmployees(businessId, preview.rows);
      setImportResult(result);
      if (result.success > 0) {
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1800);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl my-8">
        <div className="mb-5 flex items-center justify-between border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">Bulk Import Employees</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {importResult && (
          <div
            className={`mb-4 rounded-lg p-4 text-sm ${
              importResult.failed === 0 ? 'bg-brand-50 text-brand-800' : 'bg-amber-50 text-amber-800'
            }`}
          >
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle className="h-4 w-4 text-brand-600" />
              Import complete: {importResult.success} employees created successfully
              {importResult.failed > 0 && `, ${importResult.failed} failed`}.
            </div>
            {importResult.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-red-600">
                {importResult.errors.slice(0, 5).map((e, idx) => (
                  <li key={idx}>
                    Row {e.row}: {e.message}
                  </li>
                ))}
                {importResult.errors.length > 5 && (
                  <li>...and {importResult.errors.length - 5} more error(s)</li>
                )}
              </ul>
            )}
          </div>
        )}

        {!preview && (
          <div className="space-y-4">
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-blue-800">
              <p className="font-semibold text-blue-900 mb-1 flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-blue-600" />
                Cost Center & Branch Assignment Supported
              </p>
              <p>
                Include <code className="rounded bg-blue-100 px-1 py-0.5 font-mono">branch_code</code> (e.g. HQ, BLZ) and{' '}
                <code className="rounded bg-blue-100 px-1 py-0.5 font-mono">cost_centre_code</code> (e.g. FIN-01, SLS-02)
                columns in your CSV to automatically assign employees to their cost centers.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2 text-xs">
                {branches.length > 0 && (
                  <span>
                    Available Branches:{' '}
                    {branches.map((b) => b.code ? `${b.name} (${b.code})` : b.name).join(', ')}
                  </span>
                )}
              </div>
            </div>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 p-8 text-center hover:border-brand-500 hover:bg-gray-50/50 transition-colors"
            >
              <FileSpreadsheet className="h-10 w-10 text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-700">Click to upload or drag and drop employee CSV</p>
              <p className="text-xs text-gray-400 mt-1">.csv files only</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileChange(f);
                }}
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => downloadTemplate('employees')}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline"
              >
                <Download className="h-3.5 w-3.5" />
                Download Employee CSV Template
              </button>

              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isParsing && (
          <div className="flex items-center justify-center py-12 gap-2 text-sm text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
            Parsing and validating CSV...
          </div>
        )}

        {preview && !isParsing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 p-3 text-xs">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-gray-500" />
                <span className="font-medium text-gray-700">{file?.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-gray-600">Total: <strong>{preview.totalRows}</strong></span>
                <span className="text-brand-700">Valid: <strong>{preview.validRows}</strong></span>
                {preview.invalidRows > 0 && (
                  <span className="text-red-600">Invalid: <strong>{preview.invalidRows}</strong></span>
                )}
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-200">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Emp #</th>
                    <th className="px-3 py-2">Branch Code</th>
                    <th className="px-3 py-2">Cost Centre Code</th>
                    <th className="px-3 py-2">Salary</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.rows.slice(0, 15).map((r) => {
                    const bKey = (r.data['branch_code'] || r.data['branch'] || '').trim().toLowerCase();
                    const ccKey = (
                      r.data['cost_centre_code'] ||
                      r.data['cost_centre'] ||
                      r.data['department_code'] ||
                      r.data['department'] ||
                      ''
                    ).trim().toLowerCase();

                    const branchMatched = !bKey || branchCodeSet.has(bKey) || branchNameSet.has(bKey);
                    const ccMatched = !ccKey || deptCostCentreSet.has(ccKey) || deptCodeSet.has(ccKey);

                    return (
                      <tr key={r.rowNumber} className={!r.isValid ? 'bg-red-50/50' : ''}>
                        <td className="px-3 py-2 text-gray-500">{r.rowNumber}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {r.data['first_name']} {r.data['last_name']}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{r.data['employee_number'] || 'Auto'}</td>
                        <td className="px-3 py-2">
                          {bKey ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                                branchMatched ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                              }`}
                              title={branchMatched ? 'Branch matched' : 'Unmatched branch'}
                            >
                              {r.data['branch_code'] || r.data['branch']}
                              {!branchMatched && <AlertTriangle className="h-3 w-3" />}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {ccKey ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                                ccMatched ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                              }`}
                              title={ccMatched ? 'Cost centre matched' : 'Unmatched cost centre'}
                            >
                              {r.data['cost_centre_code'] || r.data['cost_centre'] || r.data['department']}
                              {!ccMatched && <AlertTriangle className="h-3 w-3" />}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {r.data['gross_salary'] || r.data['basic_salary'] || '0'}
                        </td>
                        <td className="px-3 py-2">
                          {r.isValid ? (
                            <span className="inline-flex items-center gap-1 text-brand-600">
                              <CheckCircle className="h-3.5 w-3.5" /> Valid
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600" title={r.errors.join(', ')}>
                              <AlertCircle className="h-3.5 w-3.5" /> Error
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-3">
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setFile(null);
                }}
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                Choose another file
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={isImporting || preview.validRows === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {isImporting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Import {preview.validRows} Employees
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
