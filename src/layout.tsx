import {
  Box,
  Button,
  ButtonGroup,
  Flex,
  Heading,
  IconButton,
  Image,
  Stack,
  StackProps,
  Text,
} from "@chakra-ui/react";
import { FaDiscord, FaGithub, FaInfo } from "react-icons/fa";
import { motion } from "framer-motion";
import aibtcLogoWide from "/logos/aibtcdev-primary-logo-white-wide-1000px.png";

const MotionFlex = motion(Flex);

interface HeaderProps extends Omit<StackProps, "children"> {
  showLogo?: boolean;
}

function SectionHeader({
  showLogo = true,
  ...stackProps
}: HeaderProps): React.ReactElement {
  return (
    <Stack
      align="center"
      justify="space-between"
      direction={["column", "row"]}
      px={[4, 12, 24]}
      py={[4, 8, 16]}
      {...stackProps}
    >
      <Button
        variant="aibtcOrange"
        as="a"
        href="https://evt.to/emamdeggw"
        target="_blank"
        rel="noopener noreferrer"
      >
        RSVP THURSDAYS
      </Button>
      {showLogo && (
        <Image
          src={aibtcLogoWide}
          alt="AIBTCDEV Wide Logo"
          w="50%"
          maxW="1000px"
          p={4}
        />
      )}
      <Button
        variant="aibtcOrange"
        as="a"
        href="https://github.com/aibtcdev/communication/tree/main/meetings"
        target="_blank"
        rel="noopener noreferrer"
      >
        MEETING MINUTES
      </Button>
    </Stack>
  );
}

export function Content() {
  return (
    <Box
      height="100vh"
      overflowY="scroll"
      css={{
        scrollSnapType: "y mandatory",
        "&::-webkit-scrollbar": { display: "none" },
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-1"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <SectionHeader showLogo={false} />
        <Flex flex={1} alignItems="center" justifyContent="center">
          <Image
            src={aibtcLogoWide}
            alt="AIBTCDEV Wide Logo"
            w="100%"
            maxW="1000px"
            p={4}
          />
        </Flex>
      </MotionFlex>
    </Box>
  );
}

// placeholder for possible main content
export function AdditionalContent() {
  return (
    <Stack>
      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-2"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Text fontSize="4xl">
            Imagine a world where computers are so smart, they can do almost
            anything—build things, make decisions, even talk to each other.
            While that might sound amazing, it also means these machines could
            end up controlling much of our lives. What if they start deciding
            what we can or can&apos;t do? That&apos;s a scary thought.
          </Text>
        </Stack>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-3"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Text fontSize="4xl">
            Now, consider Bitcoin. It&apos;s special because there&apos;s only a
            limited amount of it, like a rare treasure. In a world where
            computers can create more of almost everything, Bitcoin stays rare
            and valuable. This makes it really important, especially when
            everything else can be copied or made by smart machines.
          </Text>
        </Stack>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-1"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Text fontSize="4xl">
            But here&apos;s the problem: If these smart machines control
            everything, including our money, we might lose the freedom to make
            our own choices. We could end up in a world where a few people—or
            even just the machines themselves—hold all the power. That&apos;s
            where AIBTC comes in.
          </Text>
        </Stack>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-2"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Text
            fontSize="4xl"
            backgroundColor="#000"
            borderRadius="2rem"
            padding="2rem"
          >
            Imagine a world where computers are so smart, they can do almost
            anything—build things, make decisions, even talk to each other.
            While that might sound amazing, it also means these machines could
            end up controlling much of our lives. What if they start deciding
            what we can or can&apos;t do? That&apos;s a scary thought.
          </Text>
        </Stack>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-3"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Text
            fontSize="4xl"
            backgroundColor="#000"
            borderRadius="2rem"
            padding="2rem"
          >
            Now, consider Bitcoin. It&apos;s special because there&apos;s only a
            limited amount of it, like a rare treasure. In a world where
            computers can create more of almost everything, Bitcoin stays rare
            and valuable. This makes it really important, especially when
            everything else can be copied or made by smart machines.
          </Text>
        </Stack>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-1"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Text
            fontSize="4xl"
            backgroundColor="#000"
            borderRadius="2rem"
            padding="2rem"
          >
            But here&apos;s the problem: If these smart machines control
            everything, including our money, we might lose the freedom to make
            our own choices. We could end up in a world where a few people—or
            even just the machines themselves—hold all the power. That&apos;s
            where AIBTC comes in.
          </Text>
        </Stack>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-2"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Heading>
            Our community mission is to empower individuals by integrating
            Bitcoin with open-source AI, ensuring freedom, security, and
            innovation in a digital future.
          </Heading>
          <Text>
            We must ensure that this future belongs to everyone, not just a few.
            By combining Bitcoin with open-source AI, we empower individuals to
            stay free and in control, protecting our autonomy and
            revolutionizing how we live and work online.
          </Text>
        </Stack>
      </MotionFlex>

      <MotionFlex
        direction="column"
        height="100vh"
        width="100%"
        className="bg-pattern-3"
        alignItems="center"
        justifyContent="center"
        scrollSnapAlign="start"
        flexShrink={0}
      >
        <SectionHeader />
        <Stack
          flexGrow={1}
          width="90%"
          alignItems="flex-start"
          justifyContent="center"
        >
          <Heading>3rd Panel</Heading>
          <Text>Could insert something here, represents 3rd background.</Text>
        </Stack>
      </MotionFlex>
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
