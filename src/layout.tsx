import {
  Button,
  ButtonGroup,
  Flex,
  IconButton,
  Image,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FaDiscord, FaGithub, FaInfo } from "react-icons/fa";
import aibtcLogoWide from "/logos/aibtcdev-primary-logo-white-wide-1000px.png";

export function Content() {
  return (
    <Flex direction="column" height="100vh" className="bg-pattern-1">
      <Stack
        align="center"
        justify="space-between"
        direction={["column", "row"]}
        px={[4, 12, 24]}
        py={[4, 8, 16]}
      >
        <Button variant="aibtcOrange">RSVP THURSDAYS</Button>
        <Button variant="aibtcOrange">MEETING MINUTES</Button>
      </Stack>
      <Flex flex={1} alignItems="center" justifyContent="center">
        <Image
          src={aibtcLogoWide}
          alt="AIBTCDEV Wide Logo"
          w="100%"
          maxW="1000px"
          p={4}
        />
      </Flex>
    </Flex>
  );
}

export function Footer() {
  return (
    <Stack align="center" justify="space-between" direction="row" p={4}>
      <Text>&copy; 2024</Text>
      <ButtonGroup>
        <IconButton
          isRound
          _hover={{ bg: "orange.400", color: "white" }}
          aria-label="Working Group Info"
          title="Working Group Info"
          icon={<FaInfo />}
          size={["sm", null, "md"]}
          as="a"
          href="https://github.com/orgs/stacks-network/discussions/531"
          target="_blank"
          rel="noopener noreferrer"
        />
        <IconButton
          isRound
          _hover={{ bg: "orange.400", color: "white" }}
          aria-label="GitHub Resources"
          title="GitHub Resources"
          icon={<FaGithub />}
          size={["sm", null, "md"]}
          as="a"
          href="https://github.com/aibtcdev"
          target="_blank"
          rel="noopener noreferrer"
        />
        <IconButton
          isRound
          _hover={{ bg: "orange.400", color: "white" }}
          aria-label="Discord"
          title="Discord"
          icon={<FaDiscord />}
          size={["sm", null, "md"]}
          as="a"
          href="https://discord.gg/5DJaBrf"
          target="_blank"
          rel="noopener noreferrer"
        />
      </ButtonGroup>
    </Stack>
  );
}
