import {
  createMultiStyleConfigHelpers,
  extendTheme,
  type StyleFunctionProps,
  type ThemeConfig,
} from "@chakra-ui/react";
import { tabsAnatomy } from "@chakra-ui/anatomy";
import { mode } from "@chakra-ui/theme-tools";

// Chakra theme configuration

const config: ThemeConfig = {
  initialColorMode: "dark",
  useSystemColorMode: false,
};

const colors = {
  aibtc: {
    orange: {
      50: "#FFF2E6",
      100: "#FFE0CC",
      200: "#FFC199",
      300: "#FFA266",
      400: "#FF8333",
      500: "#FF4F03", // original orange
      600: "#CC3F02",
      700: "#992F02",
      800: "#661F01",
      900: "#331001",
    },
    blue: {
      50: "#E6E9F8",
      100: "#CCD3F1",
      200: "#99A7E3",
      300: "#667BD5",
      400: "#334FC7",
      500: "#0533D1", // original blue
      600: "#0429A7",
      700: "#031F7D",
      800: "#021453",
      900: "#010A2A",
    },
    gray: {
      50: "#F2F2F2",
      100: "#E6E6E6",
      200: "#CCCCCC",
      300: "#B3B3B3",
      400: "#999999",
      500: "#58595B", // original gray
      600: "#464749",
      700: "#353537",
      800: "#232325",
      900: "#121212",
    },
    black: "#000000",
    white: "#FFFFFF",
  },
};

const buttonStyles = {
  variants: {
    aibtcOrange: {
      bg: "aibtc.orange.500",
      color: "white",
      _hover: {
        bg: "aibtc.orange.600",
      },
      _active: {
        bg: "aibtc.orange.700",
      },
    },
  },
};

const fonts = {
  heading: "DM Sans 9pt, Open Sans, sans-serif",
  body: "DM Sans 9pt, Open Sans, sans-serif",
};

const globalStyles = {
  "body, html": {
    bg: "aibtc.black",
  },
  ".spin": {
    animation: "spin 1s linear infinite",
  },
  "@keyframes spin": {
    "0%": { transform: "rotate(0deg)" },
    "100%": { transform: "rotate(360deg)" },
  },
};

const gradients = {
  "aibtc-gradient-up":
    "linear-gradient(to bottom, var(--chakra-colors-aibtc-blue-500), var(--chakra-colors-aibtc-orange-500))",
  "aibtc-gradient-down":
    "linear-gradient(to bottom, var(--chakra-colors-aibtc-orange-500), var(--chakra-colors-aibtc-blue-500))",
  "aibtc-gradient-left":
    "linear-gradient(to left, var(--chakra-colors-aibtc-blue-500), var(--chakra-colors-aibtc-orange-500))",
  "aibtc-gradient-right":
    "linear-gradient(to right, var(--chakra-colors-aibtc-orange-500), var(--chakra-colors-aibtc-blue-500))",
};

const linkStyles = {
  baseStyle: (props: StyleFunctionProps) => ({
    color: mode("aibtcdev.orange.500", "aibtcdev.orange.300")(props),
    _hover: {
      textDecoration: "underline",
    },
  }),
};

const tabsStyleHelpers = createMultiStyleConfigHelpers(tabsAnatomy.keys);

// Define the base component styles
const tabsBaseStyle = tabsStyleHelpers.definePartsStyle({
  tab: {
    fontWeight: "semibold",
    _selected: (props: StyleFunctionProps) => ({
      borderTop: "5px solid",
      color: mode("aibtcdev.orange.500", "aibtcdev.orange.300")(props),
    }),
  },
});

// Export the component theme
export const tabsTheme = tabsStyleHelpers.defineMultiStyleConfig({
  baseStyle: tabsBaseStyle,
});

const theme = extendTheme({
  config,
  colors,
  components: {
    Button: buttonStyles,
    Link: linkStyles,
    Tabs: tabsTheme,
  },
  fonts,
  gradients,
  styles: {
    global: globalStyles,
  },
});

export default theme;
