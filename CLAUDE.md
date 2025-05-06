# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
- No specific build/lint commands as this is a vanilla HTML/JS project
- Open HTML files directly in a web browser to test
- Use browser dev tools console for debugging

## Code Style Guidelines
- HTML: Use 2-space indentation
- CSS: Keep styles in the `<style>` section in the HTML head
- JavaScript:
  - Use camelCase for variable and function names
  - Use const/let over var
  - Keep functions small and focused on a single responsibility
  - Include descriptive comments for complex functions
  - Use meaningful variable names that explain their purpose
  - Prefer modern ES6+ features (arrow functions, template literals)
  - Handle edge cases and errors with defensive programming

## Naming Conventions
- Use descriptive IDs for HTML elements
- Function names should clearly indicate their action
- Configuration variables should be grouped in config objects

## Project Structure
- Main HTML files in root directory
- Self-contained applications with inline JavaScript
- Generative art focus with canvas-based rendering