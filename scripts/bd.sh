#!/bin/bash

COMMAND=$1
shift

case "$COMMAND" in
    "onboard")
        echo "✅ Authenticated with GitHub."
        gh auth status || echo "⚠️ Please run: gh auth login"
        echo "✅ bd (beads) system initialized for Agent Orchestrator."
        ;;
    "ready")
        echo "🔍 Fetching available work (Open Issues)..."
        gh issue list --state open --limit 10
        ;;
    "show")
        ISSUE_ID=$1
        if [ -z "$ISSUE_ID" ]; then echo "❌ Provide an issue ID"; exit 1; fi
        gh issue view "$ISSUE_ID"
        ;;
    "update")
        ISSUE_ID=$1
        if [ -z "$ISSUE_ID" ]; then echo "❌ Provide an issue ID"; exit 1; fi
        echo "🔄 Marking issue #$ISSUE_ID as in_progress..."
        gh issue edit "$ISSUE_ID" --add-label "in progress" 2>/dev/null || true
        gh issue assign "$ISSUE_ID" --me 2>/dev/null || true
        echo "✅ Issue updated."
        ;;
    "close")
        ISSUE_ID=$1
        if [ -z "$ISSUE_ID" ]; then echo "❌ Provide an issue ID"; exit 1; fi
        gh issue close "$ISSUE_ID" --reason completed
        echo "✅ Issue #$ISSUE_ID closed."
        ;;
    "sync")
        echo "🛫 Landing the plane... Initiating sync sequence."
        
        # --- AUTOPILOT V1 HOOK: GUARDRAILS LOCALES ---
        echo "⏳ Running pre-sync guardrails..."
        
        # 1. Obtener archivos modificados (staged + unstaged)
        MODIFIED_FILES=$(git diff --name-only HEAD)
        
        # Si no hay archivos modificados en working tree, miramos contra el remote origin
        if [ -z "$MODIFIED_FILES" ]; then
            MODIFIED_FILES=$(git diff --name-only origin/$(git branch --show-current)...HEAD 2>/dev/null)
        fi

        HAS_TS=false

        for FILE in $MODIFIED_FILES; do
            if [[ "$FILE" == *.ts || "$FILE" == *.tsx ]]; then
                HAS_TS=true
            fi
        done

        if [ "$HAS_TS" = true ]; then
            echo "🔍 TypeScript files detected. Running TS Guardrails..."
            
            # Check 1: Typechecking (si existe tsconfig)
            if [ -f "tsconfig.json" ]; then
                echo "⚡ Running tsc --noEmit..."
                npx tsc --noEmit || { echo "❌ Guardrail failed: TypeScript type errors found. Please fix them before syncing."; exit 1; }
            else
                echo "⚠️ No tsconfig.json found, skipping typecheck."
            fi

            # Check 2: Linting (si existe npm run lint)
            if grep -q '"lint":' package.json 2>/dev/null; then
                echo "🧹 Running linter..."
                npm run lint || { echo "❌ Guardrail failed: Linter errors found. Please fix them before syncing."; exit 1; }
            fi
            
            # Check 3: Tests (si existe npm test)
            if grep -q '"test":' package.json 2>/dev/null; then
                echo "🧪 Running tests..."
                npm test || { echo "❌ Guardrail failed: Tests failed. Please fix them before syncing."; exit 1; }
            fi
        fi
        
        echo "✅ All guardrails passed."
        # --- FIN GUARDRAILS ---

        git pull --rebase origin $(git branch --show-current) || { echo "❌ Rebase failed. Fix conflicts and retry."; exit 1; }
        
        if [[ -n $(git status -s) ]]; then
            echo "📝 Found uncommitted changes. Committing..."
            git add .
            git commit -m "Auto-sync from agent session"
        fi

        echo "🚀 Pushing to remote..."
        git push origin $(git branch --show-current) || { echo "❌ Push failed."; exit 1; }
        
        echo "✅ Sync complete. Work safely landed."
        ;;
    *)
        echo "Usage: bd [onboard|ready|show <id>|update <id> --status in_progress|close <id>|sync]"
        exit 1
        ;;
esac
