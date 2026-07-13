const WEBHOOK = 'https://interatell.bitrix24.com.br/rest/189/s00kb52tz12l8xo6';
const LIST_ID = 65;
const BARUERI_ID = '263';
const ES_ID = '265';

const FAMILIES = [
  // Barueri (SP)
  { name: 'Aruba - Hardware - 2081927710',      estado: BARUERI_ID },
  { name: 'Aruba - Licença - 2081927725',       estado: BARUERI_ID },
  { name: 'Aruba - Software - 2081927797',      estado: BARUERI_ID },
  { name: 'Checkpoint - Hardware - 2081928362', estado: BARUERI_ID },
  { name: 'Checkpoint - Licença - 2081928392',  estado: BARUERI_ID },
  { name: 'Checkpoint - Software - 2081928423', estado: BARUERI_ID },
  { name: 'Cisco - Hardware - 2081928474',      estado: BARUERI_ID },
  { name: 'Cisco - Licença - 2081928489',       estado: BARUERI_ID },
  { name: 'Cisco - Software - 2081928499',      estado: BARUERI_ID },
  { name: 'Fortinet - Hardware - 2081928508',   estado: BARUERI_ID },
  { name: 'Fortinet - Licença - 2081928516',    estado: BARUERI_ID },
  { name: 'Fortinet - Software - 2081928547',   estado: BARUERI_ID },
  { name: 'Furukawa - Hardware - 2101313207',   estado: BARUERI_ID },
  { name: 'Furukawa - Licença - 2101313397',    estado: BARUERI_ID },
  { name: 'Furukawa - Software - 2101314357',   estado: BARUERI_ID },
  { name: 'HP - Hardware - 2081928554',         estado: BARUERI_ID },
  { name: 'HP - Licença - 2081928561',          estado: BARUERI_ID },
  { name: 'HP - Software - 2081928580',         estado: BARUERI_ID },
  { name: 'HPE - Hardware - 2163576450',        estado: BARUERI_ID },
  { name: 'HPE - Licença - 2163576529',         estado: BARUERI_ID },
  { name: 'HPE - Software - 2163576959',        estado: BARUERI_ID },
  { name: 'Intelbras - Hardware - 2101375261',  estado: BARUERI_ID },
  { name: 'Intelbras - Licença - 2101375369',   estado: BARUERI_ID },
  { name: 'Intelbras - Software - 2101375342',  estado: BARUERI_ID },
  { name: 'Logitech - Hardware - 2081928583',   estado: BARUERI_ID },
  { name: 'Logitech - Licença - 2081928600',    estado: BARUERI_ID },
  { name: 'Logitech - Software - 2081928624',   estado: BARUERI_ID },
  { name: 'Microsoft - Hardware - 2081928639',  estado: BARUERI_ID },
  { name: 'Microsoft - Licença - 2081928677',   estado: BARUERI_ID },
  { name: 'Microsoft - Software - 2081928701',  estado: BARUERI_ID },
  { name: 'Outros - Fami - 2164790403',         estado: BARUERI_ID },
  { name: 'Palo Alto - Hardware - 2081928719',  estado: BARUERI_ID },
  { name: 'Palo Alto - Licença - 2081928724',   estado: BARUERI_ID },
  { name: 'Palo Alto - Software - 2081928739',  estado: BARUERI_ID },
  { name: 'Poly - Hardware - 2081928825',       estado: BARUERI_ID },
  { name: 'Poly - Serviços - 2081928836',       estado: BARUERI_ID },
  { name: 'Poly - Software - 2081928847',       estado: BARUERI_ID },
  { name: 'Vmware - Software - 2093070670',     estado: BARUERI_ID },
  { name: 'Yealink - Hardware - 2101377412',    estado: BARUERI_ID },
  { name: 'Yealink - Licença - 2101377485',     estado: BARUERI_ID },
  { name: 'Yealink - Software - 2101377471',    estado: BARUERI_ID },

  // Espírito Santo (ES)
  { name: 'Aruba - Hardware - 5193041599',      estado: ES_ID },
  { name: 'Checkpoint - Hardware - 5193055171', estado: ES_ID },
  { name: 'Cisco - Hardware - 5193055403',      estado: ES_ID },
  { name: 'Fortinet - Hardware - 5193055497',   estado: ES_ID },
  { name: 'Furukawa - Hardware - 5226919005',   estado: ES_ID },
  { name: 'HP - Hardware - 5193056281',         estado: ES_ID },
  { name: 'HPE - Hardware - 5409033867',        estado: ES_ID },
  { name: 'Intelbras - Hardware - 5227063785',  estado: ES_ID },
  { name: 'Logitech - Hardware - 5193056425',   estado: ES_ID },
  { name: 'Microsoft - Hardware - 5407897042',  estado: ES_ID },
  { name: 'Outros - Fami - 5411396394',         estado: ES_ID },
  { name: 'Poly - Hardware - 5193057202',       estado: ES_ID },
  { name: 'Yealink - Hardware - 5227091521',    estado: ES_ID },
];

async function bPost(path, body) {
  const res = await fetch(`${WEBHOOK}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  console.log(`Cadastrando ${FAMILIES.length} famílias na Lista Bitrix24 #${LIST_ID}...\n`);
  let ok = 0, err = 0;

  for (const f of FAMILIES) {
    const code = `fam_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const res = await bPost('/lists.element.add.json', {
      IBLOCK_TYPE_ID: 'lists',
      IBLOCK_ID: LIST_ID,
      ELEMENT_CODE: code,
      fields: {
        NAME: f.name,
        PROPERTY_389: f.estado,
      },
    });

    if (res.result) {
      console.log(`✅ [${res.result}] ${f.name}`);
      ok++;
    } else {
      console.error(`❌ ${f.name} — ${JSON.stringify(res.error_description || res)}`);
      err++;
    }

    // pequena pausa para não bater rate-limit
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\nConcluído: ${ok} criados, ${err} erros.`);
}

main().catch(console.error);
