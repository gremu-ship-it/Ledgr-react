import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json, Row } from '../types/database';

export interface BomComponentDraft {
  component_product_id: string | null;
  component_bom_id: string | null;
  quantity: number;
  unit_of_measure: string | null;
  scrap_pct: number;
  notes: string | null;
}

export interface BomComponentTree extends Row<'manufacturing_bom_lines'> {
  product: Pick<Row<'products'>, 'id' | 'name' | 'sku' | 'unit_of_measure'> | null;
  subassembly: BomVersionTree | null;
}

export interface BomVersionTree extends Row<'manufacturing_boms'> {
  product: Pick<Row<'products'>, 'id' | 'name' | 'sku' | 'unit_of_measure'> | null;
  components: BomComponentTree[];
}

const MAX_BOM_DEPTH = 32;

export class BomRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async listBoms(businessId: string): Promise<Row<'manufacturing_boms'>[]> {
    const { data, error } = await this.client
      .from('manufacturing_boms')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getBom(businessId: string, bomId: string): Promise<Row<'manufacturing_boms'>> {
    const { data, error } = await this.client
      .from('manufacturing_boms')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', bomId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('BOM was not found for this business');
    return data;
  }

  async listVersions(businessId: string, productId: string): Promise<Row<'manufacturing_boms'>[]> {
    const { data, error } = await this.client
      .from('manufacturing_boms')
      .select('*')
      .eq('business_id', businessId)
      .eq('product_id', productId)
      .order('version', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getVersionTree(businessId: string, bomId: string): Promise<BomVersionTree> {
    return this.loadVersionTree(businessId, bomId, new Set(), 0);
  }

  async saveVersion(input: {
    businessId: string;
    bomId: string | null;
    productId: string;
    notes: string | null;
    components: BomComponentDraft[];
  }): Promise<string> {
    const { data, error } = await this.client.rpc('save_bom_version', {
      p_business_id: input.businessId,
      p_bom_id: input.bomId,
      p_product_id: input.productId,
      p_notes: input.notes,
      p_components: input.components as unknown as Json,
    });
    if (error) throw error;
    if (!data) throw new Error('The saved BOM version did not return an identifier');
    return data;
  }

  async activateVersion(bomId: string): Promise<Row<'manufacturing_boms'>> {
    const { error: activationError } = await this.client.rpc('manufacturing_bom_activate', {
      p_bom_id: bomId,
    });
    if (activationError) throw activationError;

    const { data, error } = await this.client
      .from('manufacturing_boms')
      .select('*')
      .eq('id', bomId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('The activated BOM version was not found');
    return data;
  }

  async newVersion(bomId: string): Promise<string> {
    const { data, error } = await this.client.rpc('manufacturing_bom_new_version', {
      p_bom_id: bomId,
    });
    if (error) throw error;
    if (!data) throw new Error('The new BOM version did not return an identifier');
    return data;
  }

  private async loadVersionTree(
    businessId: string,
    bomId: string,
    ancestorProducts: Set<string>,
    depth: number,
  ): Promise<BomVersionTree> {
    if (depth >= MAX_BOM_DEPTH) throw new Error('BOM nesting exceeds the supported display depth');

    const bom = await this.getBom(businessId, bomId);
    if (ancestorProducts.has(bom.product_id)) {
      throw new Error('BOM cycle detected while loading sub-assemblies');
    }
    const nextAncestors = new Set(ancestorProducts).add(bom.product_id);

    const [lineResult, productResult] = await Promise.all([
      this.client
        .from('manufacturing_bom_lines')
        .select('*')
        .eq('bom_id', bomId)
        .order('created_at', { ascending: true }),
      this.client
        .from('products')
        .select('id,name,sku,unit_of_measure')
        .eq('id', bom.product_id)
        .eq('business_id', businessId)
        .maybeSingle(),
    ]);
    if (lineResult.error) throw lineResult.error;
    if (productResult.error) throw productResult.error;

    const lines = lineResult.data ?? [];
    const productIds = [...new Set(lines.flatMap((line) => line.component_product_id ? [line.component_product_id] : []))];
    const productById = new Map<string, Pick<Row<'products'>, 'id' | 'name' | 'sku' | 'unit_of_measure'>>();
    if (productIds.length) {
      const { data, error } = await this.client
        .from('products')
        .select('id,name,sku,unit_of_measure')
        .eq('business_id', businessId)
        .in('id', productIds);
      if (error) throw error;
      for (const product of data ?? []) productById.set(product.id, product);
    }

    const components = await Promise.all(lines.map(async (line): Promise<BomComponentTree> => {
      const subassembly = line.component_bom_id
        ? await this.loadVersionTree(businessId, line.component_bom_id, nextAncestors, depth + 1)
        : null;
      return {
        ...line,
        product: line.component_product_id ? productById.get(line.component_product_id) ?? null : null,
        subassembly,
      };
    }));

    return { ...bom, product: productResult.data, components };
  }
}
