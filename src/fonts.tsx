import { Global, css } from "@emotion/react";

const rocGrotesk = css`
  @font-face {
    font-family: "Roc Grotesk Regular";
    src: url("/fonts/RocGrotesk-Regular.woff2") format("woff2"),
      url("/fonts/RocGrotesk-Regular.woff") format("woff");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: "Roc Grotesk Wide";
    src: url("/fonts/RocGrotesk-WideMedium.woff2") format("woff2"),
      url("/fonts/RocGrotesk-WideMedium.woff") format("woff");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
  @font-face {
    font-family: "Roc Grotesk Extra Wide";
    src: url("/fonts/RocGrotesk-ExtraWideMedium.woff2") format("woff2"),
      url("/fonts/RocGrotesk-ExtraWideMedium.woff") format("woff");
    font-weight: normal;
    font-style: normal;
    font-display: swap;
  }
`;

export default function CustomFonts() {
  return <Global styles={rocGrotesk} />;
}
