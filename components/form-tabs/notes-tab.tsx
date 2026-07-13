"use client"

import type { UseFormReturn } from "react-hook-form"
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form"
import { Textarea } from "@/components/ui/textarea"

interface NotesTabProps {
  form: UseFormReturn<any>
}

export function NotesTab({ form }: NotesTabProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Observações</h2>

      <div className="space-y-4">
        <FormField
          control={form.control}
          name="notes.internalNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Observação Interna</FormLabel>
              <FormControl>
                <Textarea placeholder="Observações para uso interno" className="min-h-[150px]" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="notes.externalNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Observação Externa</FormLabel>
              <FormControl>
                <Textarea placeholder="Observações para o cliente" className="min-h-[150px]" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  )
}
