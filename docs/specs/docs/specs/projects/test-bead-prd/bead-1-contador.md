# BEAD: Implementar contador en memoria

## TARGET_FILES
- src/features/contador/contador.types.ts
- src/features/contador/contador.ts

## INTERFACE_CONTRACT
```typescript
export interface IContador {
  value: number;
  increment(): void;
  decrement(): void;
}
```

## LOGIC_RULES
- Estado inicial `value = 0`.
- `increment()` aumenta `value` en 1.
- `decrement()` reduce `value` en 1 (límite inferior 0).

## VERIFICATION_COMMAND
npm run lint