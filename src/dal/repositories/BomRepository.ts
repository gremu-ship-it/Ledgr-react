import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Row } from '../types/database';

export interface BomComponentDraft {
  component_product_id: string | null;
  component_bom_version_id: string | null;
  quantity: number;
  unit_of_measure: string;
  scrap_percentage: number;
  sort_order: number;
  notes: string | null;
}

export interface BomComponentTree extends Row<'bom_components'> {
  product: Pick<Row<'products'>, 'id' | 'name' | 'sku' | 'unit_of_measure'> | null;
  subassembly: BomVersionTree | null;
}

export interface BomVersionTree extends Row<'bom_versions'> {
  bom: Row<'boms'>;
  components: BomComponentTree[];
}

const MAX_BOM_DEPTH = 32;

export class BomRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async listBoms(businessId: string): Promise<Row<'boms'>[]> {
    const { data, error } = await this.client
      .from('boms')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getBom(businessId: string, bomId: string): Promise<Row<'boms'>> {
    const { data, error } = await this.client
      .from('boms')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', bomId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('BOM was not found for this business');
    return data;
  }

  async listVersions(businessId: string, bomId: string): Promise<Row<'bom_versions'>[]> {
    const { data, error } = await this.client
      .from('bom_versions')
      .select('*')
      .eq('business_id', businessId)
      .eq('bom_id', bomId)
      .order('version_number', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getVersionTree(businessId: string, versionId: string): Promise<BomVersionTree> {
    return this.loadVersionTree(businessId, versionId, new Set(), 0);
  }

  async saveVersion(input: {
    businessId: string;
    bomId: string | null;
    code: string;
    name: string;
    productId: string;
    versionLabel: string | null;
    components: BomComponentDraft[];
  }): Promise<string> {
    const { data, error } = await this.client.rpc('save_bom_version', {
      p_business_id: input.businessId,
      p_bom_id: input.bomId,
      p_code: input.code,
      p_name: input.name,
      p_product_id: input.productId,
      p_version_label: input.versionLabel,
      p_components: input.components as unknown as Json,
    });
    if (error) throw error;
    if (!data) throw new Error('The saved BOM version did not return an identifier');
    return data;
  }

  async activateVersion(businessId: string, versionId: string): Promise<Row<'bom_versions'>> {
    const { data, error } = await this.client.rpc('activate_bom_version', {
      p_business_id: businessId,
      p_bom_version_id: versionId,
    });
    if (error) throw error;
    if (!data) throw new Error('The activated BOM version was not returned');
    return data;
  }

  private async loadVersionTree(
    businessId: string,
    versionId: string,
    ancestors: Set<string>,
    depth: number,
  ): Promise<BomVersionTree> {
    if (ancestors.has(versionId)) throw new Error('BOM cycle detected while loading sub-assemblies');
    if (depth >= MAX_BOM_DEPTH) throw new Error('BOM nesting exceeds the supported display depth');

    const nextAncestors = new Set(ancestors).add(versionId);
    const { data: version, error: versionError } = await this.client
      .from('bom_versions')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', versionId)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!version) throw new Error('BOM version was not found for this business');

    const [bom, componentResult] = await Promise.all([
      this.getBom(businessId, version.bom_id),
      this.client
        .from('bom_components')
        .select('*')
        .eq('business_id', businessId)
        .eq('bom_version_id', versionId)
        .order('sort_order', { ascending: true }),
    ]);
    if (componentResult.error) throw componentResult.error;
    const rows = componentResult.data ?? [];
    const productIds = [...new Set(rows.flatMap((row) => row.component_product_id ? [row.component_product_id] : []))];
    const productById = new Map<string, Pick<Row<'products'>, 'id' | 'name' | 'sku' | 'unit_of_measure'>>();

    if (productIds.length) {
      const { data: products, error: productError } = await this.client
        .from('products')
        .select('id, name, sku, unit_of_measure')
        .eq('business_id', businessId)
        .in('id', productIds);
      if (productError) throw productError;
      for (const product of products ?? []) productById.set(product.id, product);
    }

    const components = await Promise.all(rows.map(async (row): Promise<BomComponentTree> => {
      let subassembly: BomVersionTree | null = null;
      if (row.component_bom_version_id) {
        subassembly = await this.loadVersionTree(
          businessId,
          row.component_bom_version_id,
          nextAncestors,
          depth + 1,
        );
      }
      return {
        ...row,
        product: row.component_product_id ? productById.get(row.component_product_id) ?? null : null,
        subassembly,
      };
    }));

    return { ...version, bom, components };
  }
}
