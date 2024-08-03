import {
  Button,
  ButtonGroup,
  IconButton,
  Image,
  Stack,
  Text,
} from "@chakra-ui/react";
import { FaDiscord, FaGithub, FaInfo } from "react-icons/fa";
import aibtcLogoWide from "/logos/aibtcdev-primary-logo-white-wide-1000px.png";

export function Header() {
  return (
    <Stack
      align="center"
      justify="space-between"
      direction="row"
      px={24}
      py={16}
    >
      <Button variant="aibtcOrange">RSVP THURSDAYS</Button>
      <Button variant="aibtcOrange">MEETING MINUTES</Button>
    </Stack>
  );
}

export function Content() {
  return (
    <Stack
      alignItems="center"
      justifyContent={["flex-start", null, "center"]}
      flexGrow={1}
    >
      <Image
        src={aibtcLogoWide}
        alt="AIBTCDEV Wide Logo"
        w="100%"
        maxW="1000px"
        py={4}
      />
    </Stack>
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
