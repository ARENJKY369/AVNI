echo "Learnings from updating supported imagery file types and fixing pixel tearing:"
echo "1. When updating supported file types in react-dropzone, ensure to use a comma separated string in the accept prop to indicate accepted extensions, rather than mime types alone when both are needed."
echo "2. Use CSS image-rendering: pixelated (e.g. Tailwind class [image-rendering:pixelated]) for zooming into low-res or scientific imagery without blurring/tearing."
echo "3. Remember to uninstall test/dev dependencies (like puppeteer) added to the package.json during the task to avoid bloating production builds, or add them using --save-dev."
