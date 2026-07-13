// Criar arquivo app/formulario/[id]/page.tsx para rota dinâmica do formulário multi-step
import React from 'react';
import FormWrapper from '@/components/FormWrapper';

interface FormularioPageProps {
  params: {
    id: string;
  };
}

export default function FormularioPage({ params }: FormularioPageProps) {
  const processId = parseInt(params.id, 10);

  if (isNaN(processId)) {
    return <div>ID inválido</div>;
  }

  return <FormWrapper processId={processId} />;
}

// ... existing code ...
