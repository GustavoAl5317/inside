'use client';

import React from 'react';
import { MultiStepForm } from './multi-step-form';

interface FormWrapperProps {
  processId?: number;
}

export default function FormWrapper({ processId }: FormWrapperProps) {
  void processId; // reservado para carregar um processo existente
  return <MultiStepForm />;
}
