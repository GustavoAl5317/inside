import { neon } from "@neondatabase/serverless"

// Inicializa a conexão com o banco de dados Neon
const sql = neon(process.env.DATABASE_URL!)

export { sql }

// Funções de consulta ao banco de dados
export async function searchProducts(query: string) {
  try {
    const products = await sql`
      SELECT id, partnumber, description, cfop, nature, family, ncm
      FROM products
      WHERE partnumber ILIKE ${"%" + query + "%"} OR description ILIKE ${"%" + query + "%"}
      LIMIT 10
    `
    return products
  } catch (error) {
    console.error("Error searching products:", error)
    return []
  }
}

export async function getProductById(id: number) {
  try {
    const [product] = await sql`
      SELECT id, partnumber, description, cfop, nature, family, ncm
      FROM products
      WHERE id = ${id}
    `
    return product
  } catch (error) {
    console.error("Error getting product by ID:", error)
    return null
  }
}

export async function createTransaction(data: any) {
  try {
    await sql`BEGIN`

    try {
      // Inserir o negócio
      const [business] = await sql`
        INSERT INTO businesses (
          name, commercial_proposal, purchase_order_date, delivery_deadline,
          purchase_payment_condition, expected_billing_date, sale_payment_condition
        ) VALUES (
          ${data.business.name},
          ${data.business.commercialProposal || null},
          ${data.business.purchaseOrderDate},
          ${data.business.deliveryDeadline},
          ${data.business.purchasePaymentCondition},
          ${data.business.expectedBillingDate},
          ${data.business.salePaymentCondition}
        ) RETURNING id
      `

      // 2.1 Fornecedor
      let supplierId
      const existingSupplier = await sql`
        SELECT id FROM companies WHERE cnpj = ${data.companies.supplier.cnpj}
      `

      if (existingSupplier.length > 0) {
        supplierId = existingSupplier[0].id
      } else {
        const [newSupplier] = await sql`
          INSERT INTO companies (
            cnpj, name, state_registration, zip_code, city, state, neighborhood,
            address, number, complement, contact_name, phone, email, company_type
          ) VALUES (
            ${data.companies.supplier.cnpj},
            ${data.companies.supplier.name},
            ${data.companies.supplier.stateRegistration || null},
            ${data.companies.supplier.zipCode || null},
            ${data.companies.supplier.city || null},
            ${data.companies.supplier.state || null},
            ${data.companies.supplier.neighborhood || null},
            ${data.companies.supplier.address || null},
            ${data.companies.supplier.number || null},
            ${data.companies.supplier.complement || null},
            ${data.companies.supplier.contactName || null},
            ${data.companies.supplier.phone || null},
            ${data.companies.supplier.email || null},
            ${"supplier"}
          ) RETURNING id
        `
        supplierId = newSupplier.id
      }

      // 2.2 Cliente
      let customerId
      const existingCustomer = await sql`
        SELECT id FROM companies WHERE cnpj = ${data.companies.customer.cnpj}
      `

      if (existingCustomer.length > 0) {
        customerId = existingCustomer[0].id
      } else {
        const [newCustomer] = await sql`
          INSERT INTO companies (
            cnpj, name, state_registration, zip_code, city, state, neighborhood,
            address, number, complement, contact_name, phone, email, is_taxpayer, purchase_order, company_type
          ) VALUES (
            ${data.companies.customer.cnpj},
            ${data.companies.customer.name},
            ${data.companies.customer.stateRegistration || null},
            ${data.companies.customer.zipCode || null},
            ${data.companies.customer.city || null},
            ${data.companies.customer.state || null},
            ${data.companies.customer.neighborhood || null},
            ${data.companies.customer.address || null},
            ${data.companies.customer.number || null},
            ${data.companies.customer.complement || null},
            ${data.companies.customer.contactName || null},
            ${data.companies.customer.phone || null},
            ${data.companies.customer.email || null},
            ${data.companies.customer.isTaxpayer || false},
            ${data.companies.customer.purchaseOrder || null},
            ${"customer"}
          ) RETURNING id
        `
        customerId = newCustomer.id
      }

      // 2.3 Interatell
      let interatellId
      const existingInteratell = await sql`
        SELECT id FROM companies WHERE cnpj = ${data.companies.interatell.cnpj}
      `

      if (existingInteratell.length > 0) {
        interatellId = existingInteratell[0].id
      } else {
        const [newInteratell] = await sql`
          INSERT INTO companies (
            cnpj, name, state_registration, zip_code, city, state, neighborhood,
            address, number, complement, contact_name, phone, email, company_type
          ) VALUES (
            ${data.companies.interatell.cnpj},
            ${data.companies.interatell.name},
            ${data.companies.interatell.stateRegistration || null},
            ${data.companies.interatell.zipCode || null},
            ${data.companies.interatell.city || null},
            ${data.companies.interatell.state || null},
            ${data.companies.interatell.neighborhood || null},
            ${data.companies.interatell.address || null},
            ${data.companies.interatell.number || null},
            ${data.companies.interatell.complement || null},
            ${data.companies.interatell.contactName || null},
            ${data.companies.interatell.phone || null},
            ${data.companies.interatell.email || null},
            ${"interatell"}
          ) RETURNING id
        `
        interatellId = newInteratell.id
      }

      // Inserir a transação com o payload completo salvo em payload_json
      const [transactionRecord] = await sql`
        INSERT INTO transactions (
          business_id, supplier_id, customer_id, interatell_id,
          notes, status, payload_json
        ) VALUES (
          ${business.id},
          ${supplierId},
          ${customerId},
          ${interatellId},
          ${JSON.stringify(data.notes) || null},
          ${"submitted"},
          ${JSON.stringify(data)}
        ) RETURNING id
      `

      // Inserir os itens da transação (produtos)
      for (const product of data.products) {
        await sql`
          INSERT INTO transaction_items (
            transaction_id, product_id, state, quantity,
            unit_cost, total_cost, unit_sale, total_sale
          ) VALUES (
            ${transactionRecord.id},
            ${product.id},
            ${product.state},
            ${product.quantity},
            ${product.unitCost},
            ${product.totalCost},
            ${product.unitSale},
            ${product.totalSale}
          )
        `
      }

      await sql`COMMIT`

      return { success: true, transactionId: transactionRecord.id }
    } catch (error) {
      await sql`ROLLBACK`
      throw error
    }
  } catch (error) {
    console.error("Error creating transaction:", error)
    return {
      success: false,
      error: "Erro ao criar transação: " + (error instanceof Error ? error.message : "Erro desconhecido"),
    }
  }
}

// Função para inserir logs na tabela logs
export async function insertLog(log: {
  timestamp: string | Date | number
  level: string
  message: string
  source: string
  transactionId?: string | null
  metadata?: any
}) {
  try {
    await sql`
      INSERT INTO logs (timestamp, level, message, source, transaction_id, metadata)
      VALUES (
        ${new Date(log.timestamp)},
        ${log.level},
        ${log.message},
        ${log.source},
        ${log.transactionId || null},
        ${log.metadata ? JSON.stringify(log.metadata) : null}
      )
    `
  } catch (error) {
    console.error('Erro ao inserir log no banco:', error)
  }
}
