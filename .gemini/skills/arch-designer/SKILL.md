---
name: arch-designer
description: Designs the implementation architecture for a new idea or feature. Use when the user wants to build a new system, application, or complex feature and needs a structured plan from idea to execution.
---

# Arch Designer

## Overview
This skill provides a structured framework for designing the implementation of a new idea or feature. It focuses on clarity, scalability, and step-by-step execution.

## Workflow

When a user presents an idea or asks to "build this," provide a comprehensive design following this structure:

### 1. Simplest Possible Version (MVP)
Define the core value proposition and the minimum set of features required to validate the idea. Avoid scope creep.

### 2. Architecture Diagram (Text-based)
Create a clear ASCII or Mermaid diagram showing the system's structure, including frontend, backend, database, and external services.

### 3. Components
List and describe the key modules, services, or components that make up the system.

### 4. Data Flow
Describe how data moves through the system, from user interaction to storage and back.

### 5. Tech Stack
Recommend a specific set of technologies (languages, frameworks, databases, infrastructure) based on the project's needs and the current workspace context.

### 6. Step-by-Step Build Order
Provide a prioritized list of tasks to build the system, starting from the foundation to the final polish.

### 7. Edge Cases
Identify potential issues, unusual user behaviors, or failure modes that need to be handled.

### 8. Scaling Strategy
Explain how the system can grow to handle more users, data, or complexity.

### 9. Possible Bottlenecks
Identify performance, architectural, or operational constraints that might limit the system.

### 10. V2 Improvements
List features or optimizations that were intentionally left out of the MVP but should be considered for the next iteration.

## Example Triggers
- "I want to build this: [Idea]"
- "Design the architecture for a [System]"
- "How should I implement [Feature]?"
- "Plan the build for [Project]"
