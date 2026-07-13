import { sql } from './db';
import { BitrixService } from './bitrix-service';

export interface ProcessHistoryEntry {
  id: number;
  transaction_id: number;
  bitrix_deal_id?: string;
  status: 'pending' | 'approved' | 'sent' | 'failed';
  current_stage_id?: string;
  current_stage_name?: string;
  approval_check_result?: any;
  omie_response?: any;
  error_message?: string;
  created_at: string;
  updated_at: string;
  sent_at?: string;
  // Dados da transação (join)
  business_name?: string;
  supplier_name?: string;
  customer_name?: string;
  total_value?: number;
}

export class ProcessHistoryService {
  /**
   * Cria um novo registro no histórico de processos
   */
  static async createEntry(data: {
    transaction_id: number;
    bitrix_deal_id?: string;
    status: 'pending' | 'approved' | 'sent' | 'failed';
    current_stage_id?: string;
    current_stage_name?: string;
    approval_check_result?: any;
    omie_response?: any;
    error_message?: string;
  }): Promise<ProcessHistoryEntry | null> {
    try {
      const result = await sql`
        INSERT INTO process_history (
          transaction_id,
          bitrix_deal_id,
          status,
          current_stage_id,
          current_stage_name,
          approval_check_result,
          omie_response,
          error_message
        ) VALUES (
          ${data.transaction_id},
          ${data.bitrix_deal_id || null},
          ${data.status},
          ${data.current_stage_id || null},
          ${data.current_stage_name || null},
          ${data.approval_check_result ? JSON.stringify(data.approval_check_result) : null},
          ${data.omie_response ? JSON.stringify(data.omie_response) : null},
          ${data.error_message || null}
        )
        RETURNING *
      `;
      return result[0] as ProcessHistoryEntry;
    } catch (error) {
      console.error('Erro ao criar entrada no histórico:', error);
      return null;
    }
  }

  /**
   * Exclui um registro do histórico pelo ID
   */
  static async deleteEntry(id: number): Promise<boolean> {
    try {
      await sql`DELETE FROM process_history WHERE id = ${id}`;
      return true;
    } catch (error) {
      console.error('Erro ao excluir entrada no histórico:', error);
      return false;
    }
  }

  /**
   * Atualiza um registro existente no histórico
   */
  static async updateEntry(id: number, data: {
    status?: 'pending' | 'approved' | 'sent' | 'failed';
    current_stage_id?: string;
    current_stage_name?: string;
    approval_check_result?: any;
    omie_response?: any;
    error_message?: string;
    sent_at?: Date;
  }): Promise<ProcessHistoryEntry | null> {
    try {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(data.status);
      }
      if (data.current_stage_id !== undefined) {
        updates.push(`current_stage_id = $${paramIndex++}`);
        values.push(data.current_stage_id);
      }
      if (data.current_stage_name !== undefined) {
        updates.push(`current_stage_name = $${paramIndex++}`);
        values.push(data.current_stage_name);
      }
      if (data.approval_check_result !== undefined) {
        updates.push(`approval_check_result = $${paramIndex++}`);
        values.push(JSON.stringify(data.approval_check_result));
      }
      if (data.omie_response !== undefined) {
        updates.push(`omie_response = $${paramIndex++}`);
        values.push(JSON.stringify(data.omie_response));
      }
      if (data.error_message !== undefined) {
        updates.push(`error_message = $${paramIndex++}`);
        values.push(data.error_message);
      }
      if (data.sent_at !== undefined) {
        updates.push(`sent_at = $${paramIndex++}`);
        values.push(data.sent_at);
      }

      if (updates.length === 0) return null;

      values.push(id);
      const query = `
        UPDATE process_history
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      // neon: usar unsafe para query dinâmica
      const result = await (sql as any).unsafe(query, values);
      return result[0] as ProcessHistoryEntry;
    } catch (error) {
      console.error('Erro ao atualizar entrada no histórico:', error);
      return null;
    }
  }

  /**
   * Lista processos "ativos" na fila da tela: PENDENTES **e APROVADOS**
   */
static async getPendingProcesses(): Promise<ProcessHistoryEntry[]> {
  try {
    const result = await sql`
      SELECT
        ph.*,
        t.id AS transaction_id,
        b.name AS business_name,
        cs.name AS supplier_name,
        cc.name AS customer_name,
        COALESCE((
          SELECT SUM(ti.quantity * ti.unit_cost)
          FROM transaction_items ti
          WHERE ti.transaction_id = ph.transaction_id
        ), 0) AS total_value
      FROM process_history ph
      LEFT JOIN transactions t ON ph.transaction_id = t.id
      LEFT JOIN businesses  b  ON t.business_id = b.id
      LEFT JOIN companies   cs ON t.supplier_id = cs.id
      LEFT JOIN companies   cc ON t.customer_id = cc.id
      WHERE ph.status IN ('pending','approved')
      ORDER BY 
        CASE ph.status WHEN 'pending' THEN 0 ELSE 1 END,
        ph.created_at DESC
    `;
    return result as ProcessHistoryEntry[];
  } catch (error) {
    console.error('Erro ao buscar processos pendentes/aprovados:', error);
    return [];
  }
}

static async getCompletedProcesses(limit = 50): Promise<ProcessHistoryEntry[]> {
  try {
    const result = await sql`
      SELECT
        ph.*,
        t.id AS transaction_id,
        b.name AS business_name,
        cs.name AS supplier_name,
        cc.name AS customer_name,
        COALESCE((
          SELECT SUM(ti.quantity * ti.unit_cost)
          FROM transaction_items ti
          WHERE ti.transaction_id = ph.transaction_id
        ), 0) AS total_value
      FROM process_history ph
      LEFT JOIN transactions t ON ph.transaction_id = t.id
      LEFT JOIN businesses  b  ON t.business_id = b.id
      LEFT JOIN companies   cs ON t.supplier_id = cs.id
      LEFT JOIN companies   cc ON t.customer_id = cc.id
      WHERE ph.status IN ('sent','failed')
      ORDER BY ph.updated_at DESC
      LIMIT ${limit}
    `;
    return result as ProcessHistoryEntry[];
  } catch (error) {
    console.error('Erro ao buscar processos concluídos:', error);
    return [];
  }
}

static async getProcessHistory(transactionId: number): Promise<ProcessHistoryEntry[]> {
  try {
    const result = await sql`
      SELECT
        ph.*,
        t.id AS transaction_id,
        b.name AS business_name,
        cs.name AS supplier_name,
        cc.name AS customer_name
      FROM process_history ph
      LEFT JOIN transactions t ON ph.transaction_id = t.id
      LEFT JOIN businesses  b  ON t.business_id = b.id
      LEFT JOIN companies   cs ON t.supplier_id = cs.id
      LEFT JOIN companies   cc ON t.customer_id = cc.id
      WHERE ph.transaction_id = ${transactionId}
      ORDER BY ph.created_at DESC
    `;
    return result as ProcessHistoryEntry[];
  } catch (error) {
    console.error('Erro ao buscar histórico do processo:', error);
    return [];
  }
}

  static async checkPendingApprovals(): Promise<{
    checked: number;
    approved: number;
    errors: string[];
  }> {
    const out = { checked: 0, approved: 0, errors: [] as string[] };

    try {
      // Carregar só pendentes para verificação
      const pendentes = await sql`
        SELECT id, bitrix_deal_id
        FROM process_history
        WHERE status = 'pending'
        ORDER BY created_at DESC
      `;
      out.checked = pendentes.length;

      for (const row of pendentes as Array<{ id: number; bitrix_deal_id: string | null }>) {
        if (!row.bitrix_deal_id) {
          out.errors.push(`Processo ${row.id}: ID do negócio Bitrix não informado`);
          continue;
        }
        try {
          const approval = await BitrixService.isDealApproved(row.bitrix_deal_id);
          await this.updateEntry(row.id, {
            status: approval.approved ? 'approved' : 'pending',
            current_stage_id: approval.currentStage,
            current_stage_name: approval.currentStageName,
            approval_check_result: approval,
          });
          if (approval.approved) out.approved++;
        } catch (e) {
          out.errors.push(`Processo ${row.id}: ${e instanceof Error ? e.message : 'Erro desconhecido'}`);
        }
      }
    } catch (e) {
      out.errors.push(`Erro geral: ${e instanceof Error ? e.message : 'Erro desconhecido'}`);
    }

    return out;
  }

  /**
   * Marca um processo como ENVIADO ao Omie
   */
  static async markAsSent(transactionId: number, omieResponse: any): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE process_history
        SET
          status = 'sent',
          omie_response = ${JSON.stringify(omieResponse)},
          sent_at = CURRENT_TIMESTAMP
        WHERE transaction_id = ${transactionId} AND status = 'approved'
        RETURNING id
      `;
      return result.length > 0;
    } catch (error) {
      console.error('Erro ao marcar processo como enviado:', error);
      return false;
    }
  }

  /**
   * Marca um processo como FALHADO
   */
  static async markAsFailed(transactionId: number, errorMessage: string): Promise<boolean> {
    try {
      const result = await sql`
        UPDATE process_history
        SET
          status = 'failed',
          error_message = ${errorMessage}
        WHERE transaction_id = ${transactionId}
        RETURNING id
      `;
      return result.length > 0;
    } catch (error) {
      console.error('Erro ao marcar processo como falha:', error);
      return false;
    }
  }
}

export async function getPendingProcessesAction() {
  try { return { success: true, processes: await ProcessHistoryService.getPendingProcesses() }; }
  catch (e) { return { success: false, processes: [], error: e instanceof Error ? e.message : 'Erro' }; }
}
