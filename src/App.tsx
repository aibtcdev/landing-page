import { ChakraProvider, Flex } from "@chakra-ui/react";
import theme from "./theme";
import CustomFonts from "./fonts";
import { Header, Content } from "./layout";

function App() {
  return (
    <ChakraProvider theme={theme}>
      <CustomFonts />
      <Flex
        direction="column"
        minH="100vh"
        minW="250px"
        className="bg-pattern-1"
      >
        <Header />
        <Content />
      </Flex>
    </ChakraProvider>
  );
}

export default App;
